import os
from PIL import Image, ImageDraw

def generate_brand_icons():
    # 1. Load authentic Logo-UniGo02.png
    brand_path = "client/brand/Logo-UniGo02.png"
    if not os.path.exists(brand_path):
        raise FileNotFoundError(f"Cannot find {brand_path}")
    
    orig = Image.open(brand_path)
    bbox = orig.getbbox()
    cropped = orig.crop(bbox) # 4294 x 4294
    print(f"Loaded {brand_path}, cropped size: {cropped.size}")

    # Master high-res canvas (1024 x 1024)
    # Circle with crisp white plate disc (r_plate = r * 1.06)
    # This guarantees perfect contrast in both light tabs and dark Chrome tabs
    canvas_size = 1024
    master = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(master)
    
    # Draw smooth white circle plate
    plate_margin = 28
    draw.ellipse(
        (plate_margin, plate_margin, canvas_size - plate_margin, canvas_size - plate_margin),
        fill=(255, 255, 255, 255)
    )
    
    # Resize inner UniGo blue circle and paste
    inner_margin = 56
    inner_size = canvas_size - 2 * inner_margin
    inner = cropped.resize((inner_size, inner_size), Image.Resampling.LANCZOS)
    master.paste(inner, (inner_margin, inner_margin), inner)
    
    # 2. Output directory
    icons_dir = "client/public/icons"
    os.makedirs(icons_dir, exist_ok=True)
    
    # 3. favicon-32.png (32x32)
    fav32 = master.resize((32, 32), Image.Resampling.LANCZOS)
    fav32.save(os.path.join(icons_dir, "favicon-32.png"), "PNG")
    print("Generated favicon-32.png (32x32)")
    
    # 4. icon-192.png (192x192)
    icon192 = master.resize((192, 192), Image.Resampling.LANCZOS)
    icon192.save(os.path.join(icons_dir, "icon-192.png"), "PNG")
    print("Generated icon-192.png (192x192)")

    # 5. icon-512.png (512x512)
    icon512 = master.resize((512, 512), Image.Resampling.LANCZOS)
    icon512.save(os.path.join(icons_dir, "icon-512.png"), "PNG")
    print("Generated icon-512.png (512x512)")

    # 6. icon-maskable-512.png (512x512 with 76% icon size on solid white)
    maskable = Image.new("RGBA", (512, 512), (255, 255, 255, 255))
    mask_inner_size = int(512 * 0.76)
    mask_offset = (512 - mask_inner_size) // 2
    mask_inner = master.resize((mask_inner_size, mask_inner_size), Image.Resampling.LANCZOS)
    maskable.paste(mask_inner, (mask_offset, mask_offset), mask_inner)
    maskable.save(os.path.join(icons_dir, "icon-maskable-512.png"), "PNG")
    print("Generated icon-maskable-512.png")

    # 7. apple-touch-icon.png (180x180 with 86% icon size on solid white)
    apple = Image.new("RGBA", (180, 180), (255, 255, 255, 255))
    apple_inner_size = int(180 * 0.86)
    apple_offset = (180 - apple_inner_size) // 2
    apple_inner = master.resize((apple_inner_size, apple_inner_size), Image.Resampling.LANCZOS)
    apple.paste(apple_inner, (apple_offset, apple_offset), apple_inner)
    apple.save(os.path.join(icons_dir, "apple-touch-icon.png"), "PNG")
    print("Generated apple-touch-icon.png")

    # 8. Multi-frame favicon.ico at client/public/favicon.ico
    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    master.save("client/public/favicon.ico", format="ICO", sizes=ico_sizes)
    print("Generated client/public/favicon.ico (16, 32, 48)")

    # Verify colors
    test_fav = Image.open(os.path.join(icons_dir, "favicon-32.png"))
    mid = test_fav.getpixel((16, 16))
    print(f"Verification: favicon-32 center pixel is {mid}")

if __name__ == "__main__":
    generate_brand_icons()
