"""ComfyUI API graphs for the studio's edits (upstream nodes only; the model files and LoRAs are the
ones ComfyUI_VNCCS uses). Every graph reads `input` (the picture), writes one image via SaveImage.

- qi2:      Qwen Image 2.1 instruction edit of the whole picture (optional LoRAs, e.g. VNCCS ClothesCore).
- inpaint:  Anima or an Illustrious checkpoint repaints only inside `mask` (white = repaint); the
            result is composited back over the original, so everything outside stays pixel-identical.
"""

QI2 = {
    "unet": "qwen_image_2.1_int8_convrot.safetensors", "unet_turbo": "qwen_image_2.1_turbo_int8_convrot.safetensors",
    "clip": "qwen3vl_8b_int8_convrot.safetensors", "vae": "qwen_image_2.1_vae_bf16.safetensors",
}
ANIMA = {"unet": "anima-base-v1.0.safetensors", "clip": "qwen_3_06b_base.safetensors", "vae": "qwen_image_vae.safetensors"}
ILLUSTRIOUS = {"ckpt": "waiIllustriousSDXL_v170.safetensors"}
NEGATIVE = "worst quality, low quality, blurry, deformed, extra limbs, bad anatomy, text, watermark"


def _loras(g, model_ref, loras, start=40):
    """Chains LoraLoaderModelOnly nodes; returns the last model reference."""
    for i, (name, strength) in enumerate(loras):
        nid = str(start + i)
        g[nid] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": model_ref, "lora_name": name, "strength_model": float(strength)}}
        model_ref = [nid, 0]
    return model_ref


def qi2(input_name, prompt, w, h, seed=7, turbo=True, loras=(), cache=True, negative="", prefix="ev"):
    steps, cfg = (8, 1.0) if turbo else (25, 3.0)
    g = {
        "1": {"class_type": "LoadImage", "inputs": {"image": input_name}},
        "2": {"class_type": "UNETLoader", "inputs": {"unet_name": QI2["unet_turbo" if turbo else "unet"], "weight_dtype": "default"}},
        "3": {"class_type": "CLIPLoader", "inputs": {"clip_name": QI2["clip"], "type": "qwen_image", "device": "default"}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": QI2["vae"]}},
        "5": {"class_type": "TextEncodeQwenImage21", "inputs": {"clip": ["3", 0], "vae": ["4", 0], "prompt": prompt, "negative_prompt": negative, "resolution": 1024, "images.image_1": ["1", 0]}},
        "6": {"class_type": "EmptyLatentImage", "inputs": {"width": w - w % 16, "height": h - h % 16, "batch_size": 1}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["4", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }
    model = _loras(g, ["2", 0], loras)
    if cache:
        g["9"] = {"class_type": "QwenImage21Cache", "inputs": {"model": model, "device": "gpu", "dtype": "int8"}}
        model = ["9", 0]
    g["7"] = {"class_type": "KSampler", "inputs": {"model": model, "positive": ["5", 0], "negative": ["5", 1], "latent_image": ["6", 0], "seed": int(seed), "steps": steps, "cfg": cfg, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}}
    return g


def inpaint(input_name, mask_name, prompt, model="anima", seed=7, denoise=0.9, loras=(), negative=NEGATIVE, grow=6, prefix="ev"):
    g = {
        "1": {"class_type": "LoadImage", "inputs": {"image": input_name}},
        "11": {"class_type": "LoadImageMask", "inputs": {"image": mask_name, "channel": "red"}},
        "12": {"class_type": "GrowMask", "inputs": {"mask": ["11", 0], "expand": int(grow), "tapered_corners": True}},
    }
    if model == "anima":
        g["2"] = {"class_type": "UNETLoader", "inputs": {"unet_name": ANIMA["unet"], "weight_dtype": "default"}}
        g["3"] = {"class_type": "CLIPLoader", "inputs": {"clip_name": ANIMA["clip"], "type": "stable_diffusion", "device": "default"}}
        g["4"] = {"class_type": "VAELoader", "inputs": {"vae_name": ANIMA["vae"]}}
        unet, clip, vae = ["2", 0], ["3", 0], ["4", 0]
        sampler, scheduler, steps, cfg = "er_sde", "simple", 30, 4.0
    else:
        g["2"] = {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ILLUSTRIOUS["ckpt"] if model == "illustrious" else model}}
        unet, clip, vae = ["2", 0], ["2", 1], ["2", 2]
        sampler, scheduler, steps, cfg = "euler_ancestral", "normal", 28, 6.0
    unet = _loras(g, unet, loras)
    g["5"] = {"class_type": "CLIPTextEncode", "inputs": {"clip": clip, "text": prompt}}
    g["6"] = {"class_type": "CLIPTextEncode", "inputs": {"clip": clip, "text": negative}}
    g["13"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["1", 0], "vae": vae}}
    g["14"] = {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["13", 0], "mask": ["12", 0]}}
    g["7"] = {"class_type": "KSampler", "inputs": {"model": unet, "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["14", 0], "seed": int(seed), "steps": steps, "cfg": cfg, "sampler_name": sampler, "scheduler": scheduler, "denoise": float(denoise)}}
    g["8"] = {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": vae}}
    # Only the masked pixels change: the repaint is pasted over the untouched original.
    g["15"] = {"class_type": "ImageCompositeMasked", "inputs": {"destination": ["1", 0], "source": ["8", 0], "x": 0, "y": 0, "resize_source": False, "mask": ["12", 0]}}
    g["10"] = {"class_type": "SaveImage", "inputs": {"images": ["15", 0], "filename_prefix": prefix}}
    return g


def upscale(input_name, model_name, prefix="ev"):
    """A model upscale (e.g. 4x-AnimeSharp): deterministic per pixel, so aligned pictures stay aligned."""
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": input_name}},
        "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": model_name}},
        "3": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["3", 0], "filename_prefix": prefix}},
    }
