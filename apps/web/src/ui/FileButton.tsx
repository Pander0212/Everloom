import { useRef } from 'react';
import { Button, type ButtonProps } from './Button';

/** A button that opens the file picker. */
export function FileButton({ accept, multiple, onFiles, ...rest }: ButtonProps & { accept?: string; multiple?: boolean; onFiles: (files: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <Button {...rest} onClick={() => ref.current?.click()} />
    </>
  );
}
