# Contexto del sistema

## 1. Naturaleza del sistema

El sistema corresponde a una plataforma backend distribuida de **cadena de suministro**, diseñada para una empresa con múltiples sucursales y alto volumen operativo, que actualmente se encuentra desactualizada y realiza gran parte de su gestión mediante archivos Excel.

El objetivo principal del sistema es digitalizar, ordenar y controlar los procesos relacionados con:

* Catálogo de productos.
* Proveedores.
* Órdenes de compra.
* Recepción de órdenes de compra.
* Inventario.
* Control de stock recibido.
* Control de stock vendible.
* Reposición en sala.
* Transferencias entre sucursales y centros de distribución.
* Control de vencimientos por riesgo.
* Notificaciones operativas.
* Trazabilidad de responsables y movimientos.

El sistema no debe construirse como un simple CRUD de productos, proveedores y órdenes de compra. Debe diseñarse como una solución profesional de cadena de suministro, preparada para operar en una empresa real con muchas sucursales, alto volumen de proveedores diarios, productos perecederos, reposición por terceros y necesidad de trazabilidad operativa.

## 2. Contexto empresarial

La empresa posee múltiples sucursales y maneja operaciones de abastecimiento, recepción, inventario y reposición. Actualmente, gran parte de estos procesos se gestionan en Excel, lo cual genera problemas como:

* Baja trazabilidad.
* Dificultad para saber qué se pidió y qué se recibió.
* Falta de control entre stock recibido y stock realmente vendible.
* Riesgo de productos vencidos o próximos a vencer.
* Dificultad para controlar reposiciones realizadas por proveedores externos.
* Dependencia excesiva de revisión manual.
* Falta de notificaciones automáticas.
* Falta de integración clara entre compras, recepción, inventario y sala.
* Información desactualizada o dispersa entre sucursales.

El sistema debe resolver estos problemas con una arquitectura backend seria, distribuida, trazable y preparada para producción.

## 3. Enfoque arquitectónico

El sistema debe diseñarse como un **backend distribuido**, compuesto por servicios separados por responsabilidad.

Los servicios principales sugeridos son:

```txt
Servicio Catálogo
Servicio Proveedores
Servicio Compras
Servicio Inventario
Servicio Sala / Reposición
Servicio Notificaciones
Servicio Seguridad
Servicio Auditoría
Servicio Reportes
API Gateway
Broker de Eventos
```

Cada servicio debe tener responsabilidades claras y no debe convertirse en un módulo genérico que haga todo.

La comunicación entre servicios debe realizarse mediante:

* APIs REST para operaciones sincrónicas.
* Eventos asincrónicos para notificaciones, auditoría, actualización de estados y comunicación desacoplada.
* Broker de eventos para evitar acoplamiento directo entre servicios.

Eventos importantes del dominio:

```txt
OrdenCompraCreada
OrdenCompraEmitida
OrdenCompraNotificadaProveedor
RecepcionOrdenCompraRegistrada
OrdenCompraRecibidaParcial
OrdenCompraRecibidaTotal
StockRecibidoCreado
ReposicionSalaIniciada
ReposicionSalaValidada
StockPasadoAVendible
ProductoProximoAVencerDetectado
StockBloqueado
TransferenciaStockCreada
TransferenciaStockRecibida
```

## 4. Decisión sobre Producto y Sucursal

Producto y Sucursal no deben tratarse como entidades externas.

Deben formar parte del dominio interno del sistema de cadena de suministro, ya que son elementos centrales para compras, inventario, recepción, reposición y planificación.

El sistema debe manejar internamente:

```txt
Producto
Sucursal
Centro de Distribución
Categoría de Producto
Familia Comercial
Ubicación de Inventario
Ubicación de Sala
```

El centro de distribución debe modelarse como un tipo especial de sucursal o ubicación operativa, permitiendo transferencias entre:

```txt
Centro de Distribución → Sucursal
Sucursal → Sucursal
Sucursal → Centro de Distribución
```

## 5. Separación lógica del dominio

Aunque el sistema será distribuido, el dominio debe mantenerse coherente. No se debe partir la solución de forma artificial.

Los servicios deben organizarse así:

### Servicio Catálogo

Responsable de:

* Productos.
* SKUs.
* Categorías de productos.
* Familias comerciales.
* Sucursales.
* Centros de distribución.
* Naturaleza perecedera del producto.
* Vida útil mínima y máxima esperada.
* Nivel de control de vencimiento.

### Servicio Proveedores

Responsable de:

* Proveedores.
* Categorías de proveedores.
* Contactos del proveedor.
* Usuarios del portal proveedor.
* Reponedores externos.
* Personal de despacho.
* Vendedores del proveedor.
* Relación proveedor-producto.
* UxB.
* Compra mínima.
* Costos por proveedor.
* Calendario de entrega.

### Servicio Compras

Responsable de:

* Órdenes de compra.
* Detalle de orden de compra.
* Emisión de orden de compra.
* Consulta de órdenes por proveedor.
* Avisos de despacho.
* Declaración de cantidades enviadas.
* Declaración de fecha de vencimiento más corta cuando aplique.
* Actualización del estado de la orden según recepción.

### Servicio Inventario

Responsable de:

* Recepción de órdenes de compra.
* Detalle de recepción.
* Cantidad recibida.
* Cantidad aceptada.
* Cantidad rechazada.
* Faltantes.
* Sobrantes.
* Stock recibido.
* Stock en trastienda.
* Stock vendible.
* Movimientos de inventario.
* Bloqueos.
* Mermas.
* Transferencias.
* Control de vencimientos.
* Alertas de productos próximos a vencer.

### Servicio Sala / Reposición

Responsable de:

* Layout de sala.
* Pasillos.
* Góndolas.
* Niveles de góndola.
* Secciones de góndola.
* Ubicación de productos en sala.
* Reposición en sala.
* Validación de reposición por picker interno.
* Control de ingreso de reponedores externos.
* Cambio de stock recibido a stock vendible.

### Servicio Notificaciones

Responsable de:

* Notificar al proveedor cuando se emite una orden de compra.
* Notificar al comprador o planificador cuando su orden de compra fue recepcionada.
* Notificar al comprador o planificador cuando los productos de su orden de compra pasaron a vendible.
* Notificar alertas de vencimiento.
* Notificar stock recibido no vendible.
* Reintentar notificaciones fallidas.
* Registrar histórico de notificaciones.

## 6. Objetivo funcional general

El sistema debe cubrir el flujo completo de cadena de suministro:

```txt
Creación de Orden de Compra
→ Emisión de Orden de Compra
→ Notificación al Proveedor
→ Aviso de Despacho del Proveedor
→ Recepción de Orden de Compra
→ Registro de cantidad realmente recibida
→ Creación de stock recibido
→ Reposición en sala
→ Validación por picker interno
→ Conversión a stock vendible
→ Notificación al comprador o planificador
→ Consulta de disponibilidad por POS o canal de venta
```

El sistema debe asegurar que una mercancía recibida no sea considerada automáticamente como vendible.

La regla central del sistema es:

```txt
RECIBIDO ≠ VENDIBLE
```

## 7. Orden de compra

La orden de compra representa lo que la empresa solicita al proveedor.

Debe contener:

* ID de orden de compra.
* Número de orden.
* Proveedor.
* Sucursal o centro de distribución destino.
* Usuario comprador.
* Usuario planificador, si aplica.
* Fecha de emisión.
* Fecha esperada de entrega.
* Hora esperada de entrega.
* Estado.
* Monto total estimado.
* Observaciones.

El detalle de orden de compra debe contener:

* Producto.
* SKU.
* Cantidad solicitada.
* Costo unitario.
* UxB aplicado.
* Subtotal.
* Compra mínima aplicable.

El sistema debe validar que las cantidades solicitadas respeten el UxB definido por el proveedor para cada SKU.

Ejemplo:

```txt
Si el proveedor vende Coca-Cola en paquetes de 6 unidades,
no se debe permitir solicitar 7 unidades.
Las cantidades válidas serían 6, 12, 18, 24, etc.
```

## 8. Proveedores y contactos

Cada proveedor debe tener:

* Nombre.
* NIT.
* Estado.
* Categorías que provee.
* Productos/SKUs que provee.
* Calendario de entrega.
* Días de entrega.
* Hora esperada de entrega.
* Condiciones comerciales.
* UxB por producto.
* Compra mínima por producto.
* Costo por producto.

Además, cada proveedor debe poder registrar una lista de contactos.

Los contactos pueden ser:

```txt
VENDEDOR
PERSONAL_DESPACHO
REPONEDOR_EXTERNO
ADMINISTRATIVO
OTRO
```

Los reponedores externos deben pertenecer a un proveedor y deben estar registrados como contactos del proveedor.

Un proveedor puede tener usuarios para ingresar al portal proveedor.

El portal proveedor debe permitir, como mínimo:

* Consultar órdenes de compra.
* Consultar facturas.
* Registrar aviso de despacho.
* Declarar cantidades enviadas.
* Declarar fecha de vencimiento más corta por SKU cuando aplique.

## 9. Recepción de orden de compra

La recepción de orden de compra es una entidad central del sistema.

Debe estar asociada a una orden de compra y debe registrar cuánto se recibió realmente.

Esto es necesario porque la empresa puede pedir 100 unidades y recibir solo 80.

La recepción debe contener:

* ID de recepción.
* Orden de compra asociada.
* Proveedor.
* Sucursal o centro de distribución.
* Usuario de sala que recibió.
* Fecha y hora de recepción.
* Estado de recepción.
* Observaciones.

El detalle de recepción debe contener:

* Producto.
* SKU.
* Cantidad solicitada.
* Cantidad recibida.
* Cantidad aceptada.
* Cantidad rechazada.
* Motivo de rechazo.
* Estado del detalle.

Estados posibles de recepción:

```txt
BORRADOR
EN_RECEPCION
RECIBIDA_PARCIAL
RECIBIDA_COMPLETA
RECIBIDA_CON_OBSERVACION
RECHAZADA
CERRADA
```

La recepción debe poder generar eventos como:

```txt
RecepcionOrdenCompraRegistrada
OrdenCompraRecibidaParcial
OrdenCompraRecibidaTotal
StockRecibidoCreado
```

Cuando una orden de compra sea recepcionada, el comprador o planificador que creó la orden debe recibir una notificación.

## 10. Stock recibido y stock vendible

El sistema debe distinguir claramente entre stock recibido y stock vendible.

### Stock recibido

Significa que el producto llegó y fue aceptado, pero todavía se encuentra en:

```txt
Trastienda
Depósito
Cámara fría
Centro de distribución
Zona interna
```

Este stock no debe estar disponible para el cliente.

### Stock vendible

Significa que el producto ya fue ubicado en sala, góndola o canal de venta, y fue validado por un usuario interno.

Solo el stock vendible debe estar disponible para:

```txt
POS
Ecommerce
Pedidos de cliente
Consulta de disponibilidad comercial
```

Estados sugeridos del stock:

```txt
RECIBIDO
EN_TRASTIENDA
EN_REPOSICION
VENDIBLE
BLOQUEADO
VENCIDO
MERMA
EN_TRANSFERENCIA
DEVUELTO
```

El sistema debe impedir que un producto pase a vendible sin una validación interna.

Regla obligatoria:

```txt
Ningún producto puede pasar a VENDIBLE sin una reposición o confirmación validada por un usuario interno.
```

## 11. Reposición en sala

La reposición en sala puede ser realizada por reponedores externos del proveedor, pero estos no pueden actuar solos.

El reponedor externo debe ingresar acompañado o validado por un picker interno.

La reposición debe registrar:

* Sucursal.
* Proveedor.
* Reponedor externo.
* Picker interno validador.
* Fecha y hora de inicio.
* Fecha y hora de fin.
* Estado de reposición.
* Observaciones.

El detalle de reposición debe registrar:

* Producto.
* SKU.
* Cantidad repuesta.
* Stock origen.
* Stock destino.
* Ubicación en sala.
* Estado origen.
* Estado destino.
* Fecha de vencimiento más corta visible, si aplica.
* Nivel de confianza del dato.

Estados de reposición:

```txt
PLANIFICADA
EN_PROCESO
VALIDADA
RECHAZADA
CANCELADA
```

Cuando una reposición sea validada y el stock pase a vendible, el sistema debe generar el evento:

```txt
StockPasadoAVendible
```

Este evento debe notificar al comprador o planificador asociado a la orden de compra original.

## 12. Control de vencimientos

El sistema debe resolver el problema de productos próximos a vencer sin exigir que el picker revise producto por producto.

Dado que la empresa recibe más de 30 proveedores al día, con productos variados y lotes grandes, no es realista exigir un control exhaustivo por lote para todos los productos.

El control debe ser por riesgo, por criticidad y por excepción.

El producto debe tener campos como:

* Naturaleza perecedera.
* Requiere refrigeración.
* Vida útil mínima esperada.
* Vida útil máxima esperada.
* Nivel de control de vencimiento.

Niveles de control sugeridos:

```txt
SIN_CONTROL
CONTROL_ESTIMADO
CONTROL_FECHA_CORTA
CONTROL_ESTRICTO
```

La fecha de vencimiento no debe estar en el producto maestro, porque un mismo SKU puede tener múltiples fechas de vencimiento simultáneas.

La fecha de vencimiento debe registrarse a nivel de recepción, stock o grupo operativo de control.

Dado que los proveedores no siempre entregan productos separados por lote ni informan sus lotes internos, el sistema no debe depender del lote del proveedor.

En su lugar, el sistema debe permitir registrar:

```txt
Fecha de vencimiento más corta detectada
Fuente del dato
Nivel de confianza
Cantidad aproximada afectada
```

Fuentes posibles del dato:

```txt
PROVEEDOR_DECLARADO
RECEPCION
REPOSICION_PROVEEDOR
MUESTREO
AUDITORIA
ESTIMADO_SISTEMA
NO_IDENTIFICADO
```

Niveles de confianza:

```txt
ALTO
MEDIO
BAJO
DESCONOCIDO
```

El sistema debe manejar stock con vencimiento:

```txt
Confirmado
Estimado
Desconocido
```

Para productos de control estricto, si no existe fecha identificada, el sistema debe permitir bloquear el stock o generar una tarea de auditoría.

## 13. Aviso de despacho del proveedor

Debido al alto volumen operativo del centro de distribución y las sucursales, parte de la carga de información debe trasladarse al proveedor.

El proveedor debe poder registrar un aviso de despacho desde su portal.

El aviso de despacho debe permitir declarar:

* Orden de compra relacionada.
* Fecha estimada de entrega.
* Productos enviados.
* Cantidades enviadas.
* Fecha de vencimiento más corta por SKU, si aplica.
* Observaciones.

El objetivo no es exigir al proveedor una trazabilidad perfecta de todos sus lotes internos, sino obtener información mínima útil para reducir el trabajo manual del CD y mejorar el control de vencimientos.

## 14. Transferencias entre sucursales y centro de distribución

El sistema debe contemplar transferencias de stock entre ubicaciones operativas.

Las transferencias pueden darse entre:

```txt
Centro de Distribución → Sucursal
Sucursal → Sucursal
Sucursal → Centro de Distribución
```

La transferencia debe registrar:

* Sucursal origen.
* Sucursal destino.
* Fecha de solicitud.
* Fecha de envío.
* Fecha de recepción.
* Estado.
* Observaciones.

El detalle de transferencia debe registrar:

* Producto.
* Cantidad solicitada.
* Cantidad enviada.
* Cantidad recibida.
* Estado del detalle.

La transferencia debe conservar trazabilidad del estado y del vencimiento del stock cuando aplique.

## 15. Layout de sala

El sistema debe manejar la estructura física de la sucursal:

* Pasillo.
* Góndola.
* Nivel de góndola.
* Sección de góndola.
* Familia comercial.
* Ubicación de producto en sala.

La familia comercial puede estar relacionada con la categoría del producto, pero no necesariamente es lo mismo.

Ejemplo:

```txt
Categoría del producto: Bebidas
Familia comercial de sala: Bebidas alcohólicas y frituras
```

Por lo tanto, categoría de producto y familia comercial deben modelarse como conceptos distintos.

## 16. Notificaciones obligatorias

El sistema debe enviar notificaciones en los siguientes momentos:

### Notificación al proveedor

Cuando una orden de compra sea emitida.

Evento relacionado:

```txt
OrdenCompraEmitida
```

Destinatario:

```txt
Proveedor
Vendedor del proveedor
Personal de despacho del proveedor
```

### Notificación al comprador o planificador

Cuando una orden de compra sea recepcionada parcial o totalmente.

Eventos relacionados:

```txt
OrdenCompraRecibidaParcial
OrdenCompraRecibidaTotal
```

Destinatario:

```txt
Usuario comprador
Usuario planificador
```

### Notificación al comprador o planificador

Cuando los productos asociados a su orden de compra pasen a vendible.

Evento relacionado:

```txt
StockPasadoAVendible
```

Destinatario:

```txt
Usuario comprador
Usuario planificador
```

### Notificaciones adicionales

El sistema también puede notificar:

* Productos próximos a vencer.
* Stock recibido que no ha pasado a vendible.
* Reposiciones pendientes.
* Faltantes de recepción.
* Rechazos de recepción.
* Incumplimientos del proveedor.

## 17. Auditoría y trazabilidad

El sistema debe registrar trazabilidad de:

* Quién creó la orden de compra.
* Quién emitió la orden de compra.
* A qué proveedor se notificó.
* Quién recibió la mercadería.
* Cuánto se recibió realmente.
* Qué productos fueron rechazados.
* Qué productos quedaron en stock recibido.
* Qué productos pasaron a vendible.
* Qué picker validó la reposición.
* Qué reponedor externo participó.
* Qué movimientos de inventario se generaron.
* Qué alertas de vencimiento se emitieron.
* Qué notificaciones fueron enviadas.
* Qué eventos fueron procesados.

Cada evento relevante debe registrarse para auditoría.

El sistema debe mantener un histórico de movimientos de inventario y cambios de estado.

## 18. Seguridad

El sistema debe manejar roles y permisos.

Roles sugeridos:

```txt
ADMINISTRADOR
COMPRADOR
PLANIFICADOR
USUARIO_SALA
PICKER_INTERNO
ENCARGADO_INVENTARIO
SUPERVISOR
PROVEEDOR_VENDEDOR
PROVEEDOR_DESPACHO
REPONEDOR_EXTERNO
AUDITOR
```

Reglas de seguridad importantes:

1. El proveedor solo puede ver sus propias órdenes de compra y facturas.
2. El reponedor externo solo puede registrar o participar en reposiciones asociadas a su proveedor.
3. El reponedor externo no puede validar solo el paso a vendible.
4. El paso a vendible requiere usuario interno.
5. El usuario de sala debe quedar registrado en la recepción.
6. El picker interno debe quedar registrado en la reposición.
7. El POS solo debe consultar stock vendible.
8. Las acciones críticas deben quedar auditadas.
9. Las contraseñas deben almacenarse hasheadas.
10. Debe existir control de sesión, tokens y expiración.

## 19. Integración con POS o canal de venta

El POS o canal de venta no debe consultar stock recibido ni stock en trastienda.

Solo debe consultar stock en estado:

```txt
VENDIBLE
```

El sistema debe exponer endpoints o eventos para disponibilidad comercial.

Ejemplo:

```txt
GET /stock-vendible?sku={sku}&sucursal={idSucursal}
```

Cuando el stock pase a vendible, se debe publicar un evento de disponibilidad actualizada.

## 20. Reglas de negocio principales

El sistema debe cumplir las siguientes reglas:

1. Producto y Sucursal son entidades internas del dominio.
2. El centro de distribución se modela como tipo especial de sucursal o ubicación operativa.
3. Un proveedor puede vender muchos productos.
4. Un producto puede ser vendido por muchos proveedores.
5. La relación proveedor-producto define costo, UxB, compra mínima y condiciones comerciales.
6. La cantidad solicitada en una OC debe respetar el UxB del proveedor.
7. Una orden de compra puede ser recibida total o parcialmente.
8. La recepción debe registrar cuánto llegó realmente.
9. La recepción debe registrar el usuario interno que recibió.
10. La recepción genera stock recibido, no stock vendible.
11. Stock recibido no debe estar disponible para cliente.
12. Stock vendible solo existe luego de validación de reposición o ubicación en sala.
13. El reponedor externo pertenece a un proveedor.
14. El reponedor externo no puede actuar sin validación interna.
15. El picker interno valida la reposición.
16. El paso de recibido a vendible debe generar movimiento de inventario.
17. El sistema debe notificar al proveedor cuando se emite una OC.
18. El sistema debe notificar al comprador o planificador cuando su OC fue recepcionada.
19. El sistema debe notificar al comprador o planificador cuando sus productos pasan a vendible.
20. La fecha de vencimiento no pertenece al producto maestro.
21. El control de vencimiento se maneja por recepción, stock o grupo operativo.
22. El sistema debe permitir fecha de vencimiento confirmada, estimada o desconocida.
23. Los productos con control estricto y fecha desconocida pueden bloquearse o auditarse.
24. Las auditorías de vencimiento deben ser dirigidas por riesgo.
25. El sistema debe mantener trazabilidad de todos los movimientos relevantes.

## 21. Alcance técnico inicial

La primera fase debe enfocarse en el backend.

Se debe priorizar:

* Diseño de servicios.
* Modelado de base de datos.
* APIs REST.
* Eventos de dominio.
* Seguridad.
* Notificaciones.
* Auditoría.
* Flujos críticos.
* Validaciones de negocio.

El frontend puede desarrollarse posteriormente, pero el backend debe quedar preparado para soportar:

* Portal interno.
* Portal de proveedores.
* Consulta de POS.
* Panel de recepción.
* Panel de inventario.
* Panel de sala/reposición.
* Panel de alertas.
* Reportes.

## 22. Diseño distribuido recomendado

El sistema debe poder desplegarse como backend distribuido.

Componentes sugeridos:

```txt
API Gateway
Servicio Seguridad
Servicio Catálogo
Servicio Proveedores
Servicio Compras
Servicio Inventario
Servicio Sala / Reposición
Servicio Notificaciones
Servicio Auditoría
Servicio Reportes
Broker de Eventos
Scheduler / Workers
Base de datos por servicio o PostgreSQL separado por schemas
Object Storage para documentos y evidencias
```

Si el equipo aún no tiene madurez suficiente para manejar una base de datos por servicio, se permite iniciar con una misma instancia PostgreSQL separada por schemas, manteniendo contratos claros entre servicios.

La solución debe poder evolucionar después hacia bases de datos separadas por servicio.

## 23. Calidad esperada

El sistema será utilizado por una empresa con varias sucursales, procesos operativos reales y problemas actuales derivados de una gestión manual en Excel.

Por lo tanto, la solución debe priorizar:

* Robustez.
* Trazabilidad.
* Seguridad.
* Escalabilidad.
* Separación de responsabilidades.
* Diseño distribuido.
* Manejo de eventos.
* Auditoría.
* Notificaciones asincrónicas.
* Validaciones de negocio.
* Manejo de estados.
* Control de vencimientos por riesgo.
* Operación realista.
* Mantenibilidad.
* Documentación clara.
* Preparación para crecimiento futuro.

No debe construirse como un proyecto académico. Debe diseñarse como un backend profesional preparado para clientes técnicos y exigentes.

## 24. Diagramas requeridos

El diseño debe incluir como mínimo:

```txt
1. Diagrama de clases.
2. Diagrama de casos de uso.
3. Diagrama de actividad.
4. Diagrama de estados.
5. Diagrama de secuencia.
6. Diagrama de componentes.
7. Diagrama de despliegue.
```

Los diagramas deben reflejar que el sistema será distribuido y que el backend será construido primero.

## 25. Criterio final

La solución debe diseñarse como un sistema empresarial distribuido de cadena de suministro.

No debe limitarse a digitalizar Excel.

Debe transformar el proceso operativo completo:

```txt
Proveedor
→ Orden de compra
→ Recepción real
→ Stock recibido
→ Reposición validada
→ Stock vendible
→ Venta
→ Auditoría y trazabilidad
```

La regla central del sistema debe mantenerse en todo el diseño:

```txt
RECIBIDO ≠ VENDIBLE
```

Y las notificaciones críticas deben estar garantizadas:

```txt
Orden emitida → notificar proveedor
Orden recepcionada → notificar comprador/planificador
Stock vendible → notificar comprador/planificador
```

La prioridad final del diseño debe ser:

1. Trazabilidad.
2. Robustez.
3. Control operativo realista.
4. Separación distribuida de responsabilidades.
5. Seguridad.
6. Notificaciones asincrónicas.
7. Control de vencimientos por riesgo.
8. Preparación para operación real en múltiples sucursales.
9. Mantenibilidad.
10. Escalabilidad.
