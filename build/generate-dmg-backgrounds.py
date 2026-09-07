#!/usr/bin/env python3
"""
生成 MioAgent DMG 背景图
- dmg-background.png (660x400)
- dmg-background@2x.png (1320x800)
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_dmg_background(width, height, logo_path, output_path, scale=1):
    """创建 DMG 安装背景图"""
    
    # 创建画布 - 使用深色渐变背景
    img = Image.new('RGB', (width, height), '#1a1a2e')
    draw = ImageDraw.Draw(img)
    
    # 绘制渐变背景（从深蓝到更深的蓝黑）
    for y in range(height):
        ratio = y / height
        r = int(26 * (1 - ratio * 0.3))
        g = int(26 * (1 - ratio * 0.3))
        b = int(46 * (1 - ratio * 0.5))
        draw.rectangle([(0, y), (width, y + 1)], fill=(r, g, b))
    
    # 加载并调整 logo 尺寸
    try:
        logo = Image.open(logo_path).convert('RGBA')
        
        # logo 尺寸：1x 为 120px，2x 为 240px
        logo_size = int(120 * scale)
        logo = logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
        
        # logo 位置：水平居中，垂直偏上
        logo_x = (width - logo_size) // 2
        logo_y = int(height * 0.25) - logo_size // 2
        
        # 将 logo 合成到背景上
        img.paste(logo, (logo_x, logo_y), logo)
        
    except Exception as e:
        print(f"警告：无法加载 logo: {e}")
    
    # 添加文字
    try:
        # macOS 中文字体路径（按优先级）
        font_paths = [
            ('/System/Library/Fonts/PingFang.ttc', 0),  # PingFang SC Regular
            ('/System/Library/Fonts/STHeiti Medium.ttc', 0),  # Heiti SC Medium
            ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),  # Hiragino Sans GB
            ('/Library/Fonts/Arial Unicode.ttf', None),  # Arial Unicode
        ]
        
        # 加载主标题字体（英文产品名）
        title_font_size = int(32 * scale)
        title_font = None
        for font_path, index in font_paths:
            if os.path.exists(font_path):
                try:
                    if index is not None:
                        title_font = ImageFont.truetype(font_path, title_font_size, index=index)
                    else:
                        title_font = ImageFont.truetype(font_path, title_font_size)
                    break
                except Exception as e:
                    print(f"尝试加载字体 {font_path} 失败: {e}")
                    continue
        
        if not title_font:
            print("警告：无法加载字体，使用默认字体")
            title_font = ImageFont.load_default()
        
        # 产品名称（英文）
        product_name = "MioAgent"
        
        # 获取文字边界框
        try:
            bbox = draw.textbbox((0, 0), product_name, font=title_font)
            text_width = bbox[2] - bbox[0]
        except AttributeError:
            text_width, _ = draw.textsize(product_name, font=title_font)
        
        text_x = (width - text_width) // 2
        text_y = logo_y + logo_size + int(35 * scale)
        
        # 绘制主标题（白色带阴影）
        shadow_offset = int(2 * scale)
        draw.text((text_x + shadow_offset, text_y + shadow_offset), 
                 product_name, fill='#000000', font=title_font)
        draw.text((text_x, text_y), product_name, fill='#ffffff', font=title_font)
        
        # 副标题（安装提示）
        subtitle = "将「MioAgent」拖动进「应用程序」文件夹"
        subtitle_font_size = int(16 * scale)
        subtitle_font = None
        
        for font_path, index in font_paths:
            if os.path.exists(font_path):
                try:
                    if index is not None:
                        subtitle_font = ImageFont.truetype(font_path, subtitle_font_size, index=index)
                    else:
                        subtitle_font = ImageFont.truetype(font_path, subtitle_font_size)
                    # 测试中文渲染
                    test_bbox = draw.textbbox((0, 0), subtitle, font=subtitle_font)
                    break
                except Exception as e:
                    print(f"尝试加载副标题字体 {font_path} 失败: {e}")
                    continue
        
        if not subtitle_font:
            subtitle_font = title_font
        
        try:
            bbox = draw.textbbox((0, 0), subtitle, font=subtitle_font)
            subtitle_width = bbox[2] - bbox[0]
        except AttributeError:
            subtitle_width, _ = draw.textsize(subtitle, font=subtitle_font)
        
        subtitle_x = (width - subtitle_width) // 2
        subtitle_y = text_y + int(48 * scale)
        
        # 绘制副标题（灰色带阴影）
        draw.text((subtitle_x + 1, subtitle_y + 1), subtitle, 
                 fill='#000000', font=subtitle_font)
        draw.text((subtitle_x, subtitle_y), subtitle, 
                 fill='#b0b0b0', font=subtitle_font)
        
    except Exception as e:
        print(f"警告：文字渲染失败: {e}")
        import traceback
        traceback.print_exc()
    
    # 保存
    img.save(output_path, 'PNG', optimize=True)
    print(f"✓ 已生成: {output_path} ({width}×{height})")


if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    logo_path = os.path.join(script_dir, 'icon.png')
    
    # 生成标准分辨率
    create_dmg_background(
        660, 400, 
        logo_path,
        os.path.join(script_dir, 'dmg-background.png'),
        scale=1
    )
    
    # 生成 Retina 高清
    create_dmg_background(
        1320, 800,
        logo_path,
        os.path.join(script_dir, 'dmg-background@2x.png'),
        scale=2
    )
    
    print("\n✓ DMG 背景图生成完成！")
