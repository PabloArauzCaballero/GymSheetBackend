# Dominio de membresías

Se reutilizan `membership.plans`, `memberships` y `status_history`. Los planes incorporan public ID, precio, moneda, beneficios, portada ORM, orden y disponibilidad para alta, renovación o extensión.

Una intención `PENDING_PAYMENT` no cambia la membresía. La confirmación administrativa bloquea la intención, aplica una sola extensión y registra `membership.extensions`. Una membresía activa extiende desde su vencimiento; una vencida toma como base la fecha actual.
