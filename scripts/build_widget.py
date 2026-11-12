#!/usr/bin/env python3
"""Package an interactive native SVG into a dependency-free web component."""
import argparse
import html
import json
from pathlib import Path
import re
import sys
from validate_svg import validate


def build(source, output, tag, label):
    errors = validate(source, interactive=True)
    if errors:
        raise ValueError('SVG validation failed: ' + '; '.join(errors))
    if not re.fullmatch(r'peek-[a-z][a-z0-9]*(?:-[a-z0-9]+)*', tag):
        raise ValueError('Tag must start with peek- and use lowercase ASCII letters, digits and hyphens.')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output directory is not empty; choose a new directory.')
    template = (Path(__file__).resolve().parent.parent / 'assets/widget/component.js').read_text()
    svg = re.sub(r'^\s*<\?xml[^>]*\?>', '', source.read_text(encoding='utf-8')).strip()
    tokens = {'__PEEK_TAG_JSON__': json.dumps(tag), '__PEEK_SVG_JSON__': json.dumps(svg), '__PEEK_LABEL_JSON__': json.dumps(label, ensure_ascii=False)}
    # One substitution pass: artwork containing a token is never rewritten as code.
    javascript = re.sub('|'.join(map(re.escape, tokens)), lambda match: tokens[match.group()], template)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'widget.js').write_text(javascript, encoding='utf-8')
    (output / 'artwork.svg').write_text(svg, encoding='utf-8')
    snippet = f'<script src="./widget.js" defer></script>\n<{tag} label="{html.escape(label, quote=True)}" style="--peeking-size: 240px"></{tag}>\n'
    (output / 'embed.html').write_text(snippet, encoding='utf-8')
    (output / 'index.html').write_text(f'''<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(label)} · 偷看涂鸦</title>
<style>
body{{margin:0;background:#fff;color:#000;font-family:system-ui,sans-serif}}
main{{max-width:960px;margin:auto;padding:56px 24px}}h1{{font-size:30px;margin:0 0 12px}}
p{{line-height:1.7}}.gallery{{display:flex;align-items:center;flex-wrap:wrap;gap:40px;padding:35px 0}}
figure{{margin:0}}figcaption{{text-align:center;font-size:14px}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;padding:20px;border:2px solid #000;border-radius:16px;line-height:1.6}}
button{{background:#fff;color:#000;border:2px solid #000;border-radius:20px;padding:10px 20px;cursor:pointer}}
</style><main><h1>{html.escape(label)}</h1><p>移动鼠标，看看藏在里面的小家伙。也可以触摸屏幕。试着滚动页面，或者同时观察大小不同的两个组件。</p>
<div class="gallery"><figure><{tag} label="{html.escape(label, quote=True)}" style="--peeking-size:360px"></{tag}><figcaption>默认跟随 · 自然眨眼</figcaption></figure>
<figure><{tag} style="--peeking-size:180px" idle-ms="3500"></{tag}><figcaption>小尺寸 · 闲置时闭眼</figcaption></figure></div>
<h2>放进你的网页</h2><p>将 widget.js 放入网站资源目录，再粘贴下面两行；按文件位置修改脚本路径。</p><pre>{html.escape(snippet)}</pre>
<p>一个脚本可支持同页多个同款组件。组件背景透明，尺寸可调整，不会阻止页面滚动或按钮点击。</p>
<button id="demo-button" onclick="this.textContent='按钮可以正常使用'">试试页面按钮</button>
<div style="height:700px" aria-hidden="true"></div><p>到这里也可以滚动和移动鼠标。</p></main><script src="./widget.js" defer></script></html>''', encoding='utf-8')
    (output / 'INTEGRATION.md').write_text(f'''# {label}：网页接入

将 `widget.js` 复制到网站资源目录。页面引入一次脚本，再放置任意数量的组件标签：

```html
{snippet}```

`index.html` 是可直接打开的演示页，`artwork.svg` 是可编辑原图；无需 npm、框架、CDN、图片服务器或网络请求。用内联 SVG 跟踪鼠标，不能用 `<img src="artwork.svg">` 替代组件。脚本只需加载一次；同款可复用，不同物品应使用不同的 `peek-*` 标签。

- `style="--peeking-size: 160px"`：组件宽度，也可通过正常 CSS 指定宿主宽度。
- `label="咖啡杯里的眼睛"`：读屏描述；组件本身没有按钮或键盘操作。
- `blink="off"`：关闭默认的随机眨眼。
- `idle-ms="3500"`：可选，闲置 3.5 秒后闭眼；默认不闲置闭眼。
- `tracking="off"`：停止跟随、视线回正。恢复时移除该属性。

鼠标在同一文档内移动时跟随；离开页面或窗口失焦时回正。支持响应式缩放、滚动、旋转和多个实例；触摸事件不阻断默认行为。系统开启减少动态效果时，关闭平滑追赶、随机眨眼和闲置闭眼，保留直接注视。隐藏标签页、视口外和卸载组件时会停用动画及计时器。

React/Vue 等项目可在客户端入口引入 `widget.js` 后使用同名自定义元素；SSR 时不要在服务端执行此脚本。若站点禁止内联样式，按其 CSP 策略处理组件 shadow DOM 的样式。iframe 只接收 iframe 内的指针事件；需要跟随整个页面时应把标签直接放入该页面。
''', encoding='utf-8')
    return output / 'index.html'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('svg', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--tag', required=True, help='Unique custom element name, e.g. peek-laptop')
    parser.add_argument('--label', required=True)
    args = parser.parse_args()
    try:
        print(build(args.svg.resolve(), args.out.resolve(), args.tag, args.label))
    except (ValueError, OSError) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
