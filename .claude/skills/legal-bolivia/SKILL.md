---
name: legal-bolivia
description: Marco legal boliviano para los textos legales de REPP/GymSheet — términos y condiciones, política de privacidad, normas de la comunidad y seguridad en citas, consentimiento de datos sensibles y política de retención. Fija las normas aplicables, quién responde por cada dato (REPP o el gimnasio), la lista de verificación de cada documento, las cláusulas prohibidas y la voz de los textos. Usar antes de escribir o cambiar cualquier texto legal, al tocar un consentimiento o un dato personal nuevo, y como rúbrica del agente `legal-reviewer`.
---

# Textos legales de REPP para Bolivia

Esta skill **no es asesoría legal**. Ordena el trabajo para que el abogado boliviano que firma
reciba un borrador completo, coherente con el código y sin cláusulas que tenga que quitar. Ningún
texto sube de versión vigente sin su firma.

## 1. Situación normativa

Bolivia **no tiene una ley general de protección de datos personales vigente**: el anteproyecto
de AGETIC (2024) no está promulgado. Por eso los textos se apoyan en la Constitución y en normas
sectoriales, y se escriben con el estándar del anteproyecto como piso, para no reescribirlos el
día que se promulgue.

| Norma | Qué exige a REPP |
|---|---|
| Constitución Política del Estado, art. 21 num. 2 (privacidad, intimidad, honra) | Tratar los datos con reserva y solo para lo informado |
| Constitución, art. 130–131 (acción de protección de privacidad) | Derecho a conocer, objetar, rectificar y eliminar los datos propios; el texto dice cómo pedirlo y en qué plazo se responde |
| Constitución, art. 14 (no discriminación, incluida orientación sexual e identidad de género) | La orientación nunca excluye ni expone a nadie |
| Ley 164 General de Telecomunicaciones y TIC, y su reglamento para TIC (DS 1793) | Consentimiento expreso para datos en servicios digitales; validez de la aceptación electrónica; seguridad de los datos |
| Ley 453 de Derechos de las Usuarias y los Usuarios y de las Consumidoras y los Consumidores | Información veraz y clara; prohibición de cláusulas abusivas; canal de reclamos |
| Ley 548, Código Niña, Niño y Adolescente | Protección reforzada; REPP es solo para mayores de 18 |
| Ley 348, Ley Integral para Garantizar a las Mujeres una Vida Libre de Violencia | Prevenir y atender el acoso, incluido el digital; denuncia y bloqueo efectivos |
| Código Civil (contratos de adhesión) | Contrato entendible; ley aplicable y jurisdicción bolivianas |

Los números de artículo de leyes y decretos se **verifican en la Gaceta Oficial** antes de citarlos
en un texto publicado. Si no se pudo verificar, el texto nombra la norma sin artículo.

## 2. Quién responde por cada dato

Decisión de producto (16/11/2026): la responsabilidad es **compartida**.

| Dato o función | Responsable | Encargado |
|---|---|---|
| Cuenta, credenciales, dispositivos, verificación de correo | REPP | — |
| Conocer, likes, matches, chat, mapa social, stories | REPP | — |
| Perfil social (bio, intereses, hábitos, orientación) | REPP | — |
| Selfie de verificación | REPP | — |
| Entrenamientos, medidas, progresión | REPP | — |
| Membresía, pagos en el gimnasio, acceso físico, biometría de acceso | El gimnasio | REPP |

El texto nombra a los dos, dice qué hace cada uno y da un contacto de cada lado. Los datos de la
empresa (razón social, NIT, domicilio, correo legal, contacto de privacidad) van como marcadores
`{{REPP_RAZON_SOCIAL}}`, `{{REPP_NIT}}`, `{{REPP_DOMICILIO}}`, `{{REPP_CORREO_LEGAL}}`,
`{{REPP_CONTACTO_PRIVACIDAD}}` hasta que el equipo los entregue. Un texto con marcadores no se publica.

## 3. Mapa de datos

Antes de escribir la política de privacidad, el mapa de datos se saca **del código**, no de la
memoria: cada tabla del backend con un dato personal, su finalidad, su base (contrato o
consentimiento), su responsable y su plazo de retención. Si el texto menciona un dato que el código
no guarda, o el código guarda uno que el texto no menciona, el texto está mal.

Datos sensibles que exigen **consentimiento separado, expreso y revocable**, nunca dentro de los
términos generales:

- salud y consideraciones físicas (onboarding);
- orientación sexual (opcional, oculta por defecto);
- selfie de verificación (biométrico);
- ubicación precisa (mapa social y sesiones verificadas).

## 4. Lista de verificación por documento

### Términos y condiciones
- [ ] Qué es REPP y qué no es (no es servicio de citas exclusivo, ni servicio médico).
- [ ] Solo mayores de 18; qué pasa si se detecta un menor (cierre de cuenta y borrado).
- [ ] Cómo se acepta (casilla, versión y fecha guardadas) y cómo se avisa un cambio (se pide aceptar de nuevo).
- [ ] Reglas de uso: sin acoso, sin suplantación, sin contenido sexual no consentido, sin extraer datos, sin cuentas automatizadas.
- [ ] Verificación de correo y de persona: qué habilita y qué no garantiza.
- [ ] Moderación: qué se puede suspender, cómo se avisa y cómo se reclama.
- [ ] Cierre de cuenta por la persona, en cualquier momento, desde la app.
- [ ] Límite de responsabilidad **sin** eximir a REPP de lo que la Ley 453 no permite eximir.
- [ ] Ley boliviana y jurisdicción; canal de reclamos y plazo de respuesta.

### Política de privacidad
- [ ] Responsables y contactos (sección 2).
- [ ] Qué datos, para qué, con qué base y por cuánto tiempo (mapa de datos).
- [ ] Qué ven otras personas (perfil social, edad, distancia aproximada, insignia) y qué nunca ven (orientación oculta, correo, ubicación exacta).
- [ ] Ranking de Conocer: qué factores usa, en lenguaje simple, y que no usa la orientación ni un puntaje de deseabilidad.
- [ ] Antibot: que se guarda el dispositivo, un HMAC de la IP y el tiempo de alta, y por qué.
- [ ] Proveedores que reciben datos (correo, almacenamiento, Google, Apple, Cloudflare cuando se activen) y en qué país.
- [ ] Derechos (conocer, rectificar, eliminar, exportar, revocar) y cómo ejercerlos desde la app.
- [ ] Seguridad y aviso de incidentes.

### Normas de la comunidad y seguridad en citas
- [ ] Conductas prohibidas con ejemplos concretos.
- [ ] Cómo bloquear y denunciar; qué pasa después de una denuncia.
- [ ] Consejos de seguridad para el primer encuentro (lugar público, avisar a alguien, no enviar dinero).
- [ ] Recursos de ayuda en Bolivia para violencia (línea gratuita de la Policía, FELCV) — verificar números vigentes antes de publicar.

### Consentimiento de datos sensibles
- [ ] Un consentimiento por dato, con su finalidad en una frase.
- [ ] Negarse no bloquea el resto de la app (salvo lo que depende de ese dato, dicho explícitamente).
- [ ] Cómo revocarlo, y que revocar borra el dato.

### Política de retención
- [ ] Selfie de verificación: 30 días desde la decisión.
- [ ] HMAC de IP: 90 días.
- [ ] Cuenta cerrada: plazo de borrado y qué se conserva por obligación legal.

## 5. Cláusulas prohibidas

Rechazar cualquier texto que:

- renuncie por adelantado a derechos del consumidor o a reclamar;
- permita a REPP cambiar el contrato sin aviso ni nueva aceptación;
- diga que los datos «pueden compartirse con terceros» sin nombrar a quién ni para qué;
- meta un consentimiento sensible dentro de la aceptación general;
- prometa algo que el código no hace (re-aceptación, borrado, cifrado, plazos);
- use un consentimiento premarcado.

## 6. Voz

- De tú, frases cortas, verbo primero, como el resto de la app (`repp-diseno`).
- Un concepto por párrafo; títulos que son preguntas que la persona se hace.
- Términos definidos una vez y usados igual en todos los textos.
- Nada de mayúsculas sostenidas ni de latinazgos.

## 7. Dónde viven los textos y cómo se versionan

- Una sola fuente versionada en `packages/domain/src/legal/`, que muestran la web y el móvil.
- Cada documento tiene una versión (`AAAA-MM-DD`) y el backend guarda, con cada aceptación, la
  versión y el hash del contenido aceptado.
- Subir la versión vigente obliga a todas las cuentas a aceptar de nuevo al entrar.

## 8. Proceso

1. Mapa de datos desde el código.
2. Borrador con esta skill.
3. Revisión del agente `legal-reviewer`, que no escribió el texto.
4. Correcciones hasta que no queden hallazgos bloqueantes.
5. Firma del abogado boliviano, registrada en el PR.
6. Recién entonces se sube la versión vigente.
