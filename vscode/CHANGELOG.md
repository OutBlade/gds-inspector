# Changelog

## 0.1.2

- Register file watchers and message handlers before starting the layout webview.

## 0.1.1

- Improve extension search metadata and installation instructions.
- Add browser search/share metadata and a readable viewer guide.

## 0.1.0

First release.

- Opens `.gds`, `.gds2`, `.gdsii`, `.gdsx` and `.gds.gz` files in a layout editor tab.
- 2D layer view with hierarchy, labels and level of detail; 3D metal stack with section cut.
- SKY130, GF180MCU and IHP SG13G2 layer maps; KLayout `.lyp` files are picked up next to the layout or from the `gdsInspector.layerProperties` setting.
- Shape inspector, ruler, cross-sections, cell tree and label search.
- Layer statistics, density maps, minimum widths, rule checks and EBL beam-on time.
- Reloads automatically when the file changes on disk; exports PNG, SVG, JSON and CSV.
