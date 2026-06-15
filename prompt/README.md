# prompt

> Documentación generada revisando los archivos reales de esta carpeta. No es una descripción genérica: está basada en los nombres, capas y símbolos encontrados en el código.

## Propósito de esta carpeta

Prompts y reglas que dieron origen al proyecto. No reemplaza a docs; explica cómo debía generarse.

## Cuándo modificar esta carpeta

- Cuando el cambio pertenezca claramente a la responsabilidad descrita arriba.
- Si el cambio pertenece a otra capa, muévelo a la carpeta correcta.

## Qué NO debes colocar aquí

- No mezcles responsabilidades de otras capas solo por comodidad.
- No dupliques lógica que ya exista en `shared` o en un módulo específico.

## Archivos de esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `contextSystem.md` | Documento Markdown del proyecto. |
| `index.md` | Documento Markdown del proyecto. |
| `programacionBackend.md` | Documento Markdown del proyecto. |
| `programacionGeneral.md` | Documento Markdown del proyecto. |

## Funciones, clases, tipos y objetos documentados

No hay funciones TypeScript directas en esta carpeta. Si contiene documentación, diagramas o SQL, su explicación está en la sección de archivos.

## Cómo se conecta con el flujo general

Forma parte de la estructura general que permite instalar, ejecutar, documentar o entender el backend.

## Guía rápida para alguien nuevo

1. Lee primero el propósito de la carpeta.
2. Mira las rutas si quieres saber qué endpoint existe.
3. Mira el controller para entender la entrada/salida HTTP.
4. Mira el service para entender la regla de negocio.
5. Mira el repository para entender qué tablas se consultan o modifican.
6. Mira los schemas para entender qué datos son válidos.

