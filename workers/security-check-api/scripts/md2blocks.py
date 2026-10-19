#!/usr/bin/env python3
"""Converts a Notion-flavored markdown snapshot of a TEMPLATE page (from the Notion MCP fetch) into
Notion API block JSON. Used for the dry-run preview so the Worker renders the real template layout.
Live mode reads the template through the Notion API instead."""
import json, re, sys
COLORS = {"gray_bg": "gray_background", "red_bg": "red_background", "blue_bg": "blue_background", "orange_bg": "orange_background", "green_bg": "green_background", "yellow_bg": "yellow_background"}
def unesc(s): return s.replace("\\{", "{").replace("\\}", "}").replace("\\$", "$").replace("\\[", "[").replace("\\]", "]")
def rich(s, color="default"):
    s = unesc(s).replace("<br>", "\n")
    out = []
    pos = 0
    tok = re.compile(r'<span color="(\w+)">(.*?)</span>|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)')
    def push(text, bold=False, col=None, url=None):
        if not text: return
        out.append({"type": "text", "text": {"content": text, "link": {"url": url} if url else None},
                    "annotations": {"bold": bold, "italic": False, "strikethrough": False, "underline": False, "code": False, "color": col or color}})
    for m in tok.finditer(s):
        push(s[pos:m.start()])
        if m.group(1):
            for x in rich(m.group(2), m.group(1)): out.append(x)
        elif m.group(3): push(m.group(3), True)
        else: push(m.group(4), False, None, m.group(5))
        pos = m.end()
    push(s[pos:])
    return out
def blk(t, **v): return {"type": t, t: v}
def parse(lines, i=0, indent=0):
    out = []
    while i < len(lines):
        raw = lines[i]
        lvl = len(raw) - len(raw.lstrip("\t"))
        if raw.strip() == "": i += 1; continue
        if lvl < indent: break
        line = raw.strip()
        if line.startswith("<table"):
            rows = []; j = i + 1; cur = None
            while not lines[j].strip().startswith("</table>"):
                l = lines[j].strip()
                if l == "<tr>": cur = []
                elif l == "</tr>": rows.append(cur)
                elif l.startswith("<td>"): cur.append(rich(l[4:-5]))
                j += 1
            out.append({"type": "table", "table": {"table_width": len(rows[0]), "has_column_header": True, "has_row_header": 'header-column="true"' in line}, "children": [{"type": "table_row", "table_row": {"cells": r}} for r in rows]})
            i = j + 1; continue
        if line.startswith("<callout"):
            icon = re.search(r'icon="([^"]+)"', line).group(1); color = COLORS.get(re.search(r'color="([^"]+)"', line).group(1), "default")
            j = i + 1; texts = []
            while lines[j].strip() != "</callout>": texts.append(lines[j].strip()); j += 1
            rt = []
            for n, t in enumerate(texts):
                if n: rt.append({"type": "text", "text": {"content": "\n", "link": None}, "annotations": {"bold": False, "italic": False, "strikethrough": False, "underline": False, "code": False, "color": "default"}})
                rt += rich(t)
            if len(texts) == 1 and re.fullmatch(r"\\?\{\\?\{\w+\\?\}\\?\}", texts[0]):
                out.append({"type": "callout", "callout": {"icon": {"type": "emoji", "emoji": icon}, "color": color, "rich_text": []}, "children": [blk("paragraph", rich_text=rich(texts[0]))]})
            else:
                out.append({"type": "callout", "callout": {"icon": {"type": "emoji", "emoji": icon}, "color": color, "rich_text": rt}})
            i = j + 1; continue
        if line.startswith("<database"):
            out.append({"type": "child_database", "child_database": {"title": re.sub("<[^>]+>", "", line)}}); i += 1; continue
        if line in ("<empty-block/>",) or line.startswith("<colgroup") or line.startswith("<col") or line.startswith("</colgroup"): i += 1; continue
        if line == "---": out.append(blk("divider")); i += 1; continue
        m = re.match(r"^(#{1,4}) (.*?)( \{toggle=\"true\"\})?$", line)
        if m:
            n = min(len(m.group(1)), 3); t = "heading_%d" % n
            b = {"type": t, t: {"rich_text": rich(m.group(2)), "is_toggleable": bool(m.group(3))}}
            i += 1
            if m.group(3):
                kids, i = parse(lines, i, lvl + 1); b["children"] = kids
            out.append(b); continue
        m = re.match(r"^(- |\d+\. )(.*)$", line)
        if m:
            t = "bulleted_list_item" if m.group(1) == "- " else "numbered_list_item"
            b = {"type": t, t: {"rich_text": rich(m.group(2))}}
            i += 1
            kids, i = parse(lines, i, lvl + 1)
            if kids: b["children"] = kids
            out.append(b); continue
        out.append(blk("paragraph", rich_text=rich(line))); i += 1
    return out, i
src = open(sys.argv[1]).read()
content = src.split("<content>", 1)[1].split("</content>", 1)[0].strip("\n")
blocks, _ = parse(content.split("\n"))
json.dump(blocks, open(sys.argv[2], "w"), ensure_ascii=False, indent=0)
print(sys.argv[2], len(blocks), "top-level blocks")
