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


# Qwen Image 2.1 models by name: (file, steps, cfg). noctqa: Noct Q Anime, an uncensored anime fine-tune.
QI2_MODELS = {"turbo": (QI2["unet_turbo"], 8, 1.0), "standard": (QI2["unet"], 25, 3.0), "noctqa": ("NoctQA_V1_int8_convrot.safetensors", 25, 3.0)}
QI2_NEGATIVE = "low quality, low resolution, blurry, jpeg artifacts, washed-out colors, sloppy lines, messy line art, extra fingers, missing fingers, badly drawn hands, deformed anatomy, 3d render, photograph, photorealistic"


def qi2(input_name, prompt, w, h, seed=7, turbo=True, loras=(), cache=True, negative="", prefix="ev", model=None, steps=None, cfg=None):
    unet, steps_d, cfg_d = QI2_MODELS[model or ("turbo" if turbo else "standard")]
    steps, cfg = int(steps or steps_d), float(cfg if cfg is not None else cfg_d)
    g = {
        "1": {"class_type": "LoadImage", "inputs": {"image": input_name}},
        "2": {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}},
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


# SDXL checkpoints by name: (file, steps, cfg) — WAI Illustrious and NoobAI-XL eps 1.1 (both Illustrious family).
SDXL_MODELS = {"illustrious": (ILLUSTRIOUS["ckpt"], 28, 5.5), "wai": (ILLUSTRIOUS["ckpt"], 28, 5.5), "noobai": ("NoobAI-XL-v1.1.safetensors", 28, 4.5),
               "ponywai": ("waiANIHENTAIPONYXL_v60.safetensors", 25, 6.5), "autismmix": ("autismmixSDXL_autismmixPony.safetensors", 25, 7.0)}
PONY = {"ponywai", "autismmix"}
PONY_POSITIVE = "score_9, score_8_up, score_7_up, source_anime, rating_explicit, "
SDXL_NEGATIVE = {"wai": "bad quality, worst quality, worst detail, sketch, censor, mosaic censoring, bar censor",
                 "noobai": "worst quality, old, early, low quality, lowres, signature, username, logo, bad hands, censor, mosaic censoring, anthro, furry, feral",
                 "ponywai": "score_6, score_5, score_4, source_pony, source_furry, censored, mosaic censoring, bar censor",
                 "autismmix": "score_6, score_5, score_4, source_pony, source_furry, censored, mosaic censoring, bar censor"}


def inpaint(input_name, mask_name, prompt, model="anima", seed=7, denoise=0.9, loras=(), negative=NEGATIVE, grow=6, prefix="ev",
            control_name=None, cn=None, cn_strength=0.9, diffdiff=True, steps_override=None, cfg_override=None):
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
        ckpt, steps, cfg = SDXL_MODELS.get(model, (model, 28, 5.5))
        g["2"] = {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}}
        unet, clip, vae = ["2", 0], ["2", 1], ["2", 2]
        sampler, scheduler = "euler_ancestral", "normal"
        if model in PONY:
            # Pony checkpoints are trained with CLIP skip 2.
            g["21"] = {"class_type": "CLIPSetLastLayer", "inputs": {"clip": clip, "stop_at_clip_layer": -2}}
            clip = ["21", 0]
    unet = _loras(g, unet, loras)
    if diffdiff:
        # Differential diffusion: the soft mask edge is repainted gradually, so the region blends in.
        g["16"] = {"class_type": "DifferentialDiffusion", "inputs": {"model": unet}}
        unet = ["16", 0]
    g["5"] = {"class_type": "CLIPTextEncode", "inputs": {"clip": clip, "text": prompt}}
    g["6"] = {"class_type": "CLIPTextEncode", "inputs": {"clip": clip, "text": negative}}
    pos, neg = ["5", 0], ["6", 0]
    if control_name and cn:
        # NoobAI inpainting ControlNet: the picture with the masked area blacked out guides the repaint,
        # so a region can be replaced completely (high denoise) and still fit what surrounds it.
        g["17"] = {"class_type": "LoadImage", "inputs": {"image": control_name}}
        g["18"] = {"class_type": "ControlNetLoader", "inputs": {"control_net_name": cn}}
        g["19"] = {"class_type": "ControlNetApplyAdvanced", "inputs": {"positive": pos, "negative": neg, "control_net": ["18", 0], "image": ["17", 0], "strength": float(cn_strength), "start_percent": 0.0, "end_percent": 1.0, "vae": vae}}
        pos, neg = ["19", 0], ["19", 1]
    g["20"] = {"class_type": "InpaintModelConditioning", "inputs": {"positive": pos, "negative": neg, "vae": vae, "pixels": ["1", 0], "mask": ["12", 0], "noise_mask": True}}
    g["7"] = {"class_type": "KSampler", "inputs": {"model": unet, "positive": ["20", 0], "negative": ["20", 1], "latent_image": ["20", 2], "seed": int(seed), "steps": int(steps_override or steps), "cfg": float(cfg_override or cfg), "sampler_name": sampler, "scheduler": scheduler, "denoise": float(denoise)}}
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
