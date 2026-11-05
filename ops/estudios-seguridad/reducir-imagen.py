#!/usr/bin/env python3
"""Reduce una foto para embeberla en el informe del estudio: JPG, lado mayor de 1400 px, calidad 82, respetando la
orientación EXIF del celular. Uso: reducir-imagen.py <entrada> <salida>. Rutas fijas que pasa el trabajo; nada más."""
import sys
from PIL import Image, ImageOps

origen, destino = sys.argv[1], sys.argv[2]
with Image.open(origen) as imagen:
    imagen = ImageOps.exif_transpose(imagen)
    if imagen.mode not in ('RGB', 'L'):
        fondo = Image.new('RGB', imagen.size, 'white')
        fondo.paste(imagen, mask=imagen.convert('RGBA').split()[-1])
        imagen = fondo
    imagen.thumbnail((1400, 1400))
    imagen.convert('RGB').save(destino, 'JPEG', quality=82, optimize=True)
