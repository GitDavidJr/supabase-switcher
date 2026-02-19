from PIL import Image

def resize_for_chrome_store(input_path, output_path):
    # Target size
    target_w, target_h = 1280, 800
    
    # Open original
    img = Image.open(input_path)
    
    # Create background (Supabase dark grey)
    bg = Image.new('RGB', (target_w, target_h), (28, 28, 28))
    
    # Calculate scale to fit while keeping aspect ratio
    img_w, img_h = img.size
    ratio = min(target_w / img_w, target_h / img_h)
    new_w = int(img_w * ratio)
    new_h = int(img_h * ratio)
    
    # Resize original
    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Paste centered
    offset = ((target_w - new_w) // 2, (target_h - new_h) // 2)
    bg.paste(img, offset)
    
    # Save
    bg.save(output_path, 'PNG')
    print(f"Success: Image saved to {output_path}")

if __name__ == "__main__":
    input_file = r"c:\Users\user\www\switch-supabase\Captura de tela 2026-02-19 122612 (1).png"
    output_file = r"c:\Users\user\www\switch-supabase\screenshot_google_store.png"
    resize_for_chrome_store(input_file, output_file)
