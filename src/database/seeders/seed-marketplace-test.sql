-- Semilla para Directorio, Marketplace de Planes y Pagos QR
BEGIN;

-- 1. Insertar Entidades en el Directorio
INSERT INTO directory.entities (
    id, slug, entity_type, name, headline, description, primary_category_id,
    tenant_id, user_id, logo_url, cover_url, is_online_only, city, country,
    rating_average, rating_count, rating_breakdown, is_verified, status
) VALUES (
    'd1000000-0000-4000-8000-000000000001',
    'topfitness',
    'GYM',
    'TopFitness Club & Spa',
    'Centro integral de entrenamiento de alto rendimiento y musculación',
    'TopFitness es el centro líder con equipamiento Hammer Strength y Eleiko, zona de peso libre olímpico, clases grupales y sauna.',
    'a1000000-0000-4000-8000-000000000002', -- gimnasios
    'default',
    (SELECT id FROM usuarios LIMIT 1),
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=200',
    'https://images.unsplash.com/photo-1540497077202-7c8a3999166f?w=800',
    false,
    'La Paz',
    'Bolivia',
    4.8,
    5,
    '{"1":0,"2":0,"3":0,"4":1,"5":4}'::jsonb,
    true,
    'ACTIVE'
), (
    'd1000000-0000-4000-8000-000000000002',
    'nutrizone-store',
    'STORE',
    'NutriZone Suplementos',
    'Distribuidor oficial de las mejores marcas de nutrición deportiva',
    'Tienda especializada en proteínas aisladas, creatinas Creapure, aminoácidos y accesorios de levantamiento pesado.',
    'b1000000-0000-4000-8000-000000000001', -- tiendas.nutricion
    NULL,
    (SELECT id FROM usuarios LIMIT 1),
    'https://images.unsplash.com/photo-1593095948071-474c5cc2989d?w=200',
    'https://images.unsplash.com/photo-1579722821273-0f6c7d44362f?w=800',
    true,
    'Santa Cruz',
    'Bolivia',
    5.0,
    3,
    '{"1":0,"2":0,"3":0,"4":0,"5":3}'::jsonb,
    true,
    'ACTIVE'
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    headline = EXCLUDED.headline,
    description = EXCLUDED.description;

-- 2. Configuración de Pago y QR Bancario Oficial
INSERT INTO directory.entity_payment_configs (
    id, entity_id, bank_name, account_holder_name, tax_id, account_number,
    alias_or_phone, qr_image_url, qr_payload, instructions, is_active
) VALUES (
    'e1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Banco Unión / BCP',
    'TopFitness Club S.R.L.',
    '1029384756',
    '10000-29384-91823',
    'topfitness.pago',
    'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=00020101021226460014bo.com.bcp.qr0124TopFitness_Club_Planes5204601153038405802BO5915TopFitness_SRL6007La_Paz62160112GS-TOPFIT-PAY6304C1B2',
    'BCP_QR_PAYLOAD_TEST_2026',
    'Por favor escanea el código QR desde tu banca móvil y pega el número de orden en la glosa. Tras transferir, sube tu comprobante para activación inmediata.',
    true
), (
    'e1000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000002',
    'Banco Mercantil Santa Cruz',
    'NutriZone Bolivia',
    '8392104928',
    '4010-82910-38491',
    'nutrizone.qr',
    'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=NutriZone_Payment_QR',
    'BMSC_QR_NUTRIZONE',
    'Envíos a todo el país. Sube tu comprobante y despachamos en 24 horas.',
    true
) ON CONFLICT (entity_id) DO UPDATE SET
    bank_name = EXCLUDED.bank_name,
    account_number = EXCLUDED.account_number,
    qr_image_url = EXCLUDED.qr_image_url;

-- 3. Planes y Productos en el Marketplace
INSERT INTO directory.entity_plans (
    id, entity_id, type, name, slug, description, benefits, duration_days,
    current_price, currency, status, display_order, media_urls
) VALUES (
    'f1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'MEMBERSHIP_PLAN',
    'Pase Mensual Full Pass',
    'pase-mensual-full-pass',
    'Acceso completo ilimitado a todas las instalaciones de TopFitness durante 30 días continuos.',
    '["Acceso libre a zona de musculación y cardio", "Acceso a clases de spinning y funcional", "Duchas y casilleros", "Evaluación física inicial"]'::jsonb,
    30,
    45.00,
    'USD',
    'ACTIVE',
    1,
    '[]'::jsonb
), (
    'f1000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'MEMBERSHIP_PLAN',
    'Plan Trimestral VIP Black',
    'plan-trimestral-vip-black',
    'El plan más completo: 90 días de entrenamiento premium con sesiones guiadas y acceso a zona húmeda/sauna.',
    '["Acceso 24/7 sin restricción horaria", "1 sesión semanal de coach personal", "Acceso ilimitado a sauna y crioterapia", "Toalla de cortesía en cada visita"]'::jsonb,
    90,
    120.00,
    'USD',
    'ACTIVE',
    2,
    '[]'::jsonb
), (
    'f1000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000001',
    'PASS',
    'Tiquetera 10 Entrenamientos',
    'tiquetera-10-entrenamientos',
    'Pack de 10 pases transferibles, ideal para quienes viajan frecuentemente.',
    '["10 accesos válidos por 60 días", "Transferible a amigos o familiares", "Incluye casillero"]'::jsonb,
    60,
    30.00,
    'USD',
    'ACTIVE',
    3,
    '[]'::jsonb
), (
    'f1000000-0000-4000-8000-000000000004',
    'd1000000-0000-4000-8000-000000000002',
    'PRODUCT',
    'Whey Isolate Protein 2kg',
    'whey-isolate-protein-2kg',
    'Proteína aislada microfiltrada de máxima pureza, cero carbohidratos.',
    '["27g proteína por servicio", "5.5g BCAA naturales", "Envío gratis a domicilio"]'::jsonb,
    NULL,
    65.00,
    'USD',
    'ACTIVE',
    1,
    '[]'::jsonb
) ON CONFLICT (entity_id, slug) DO UPDATE SET
    name = EXCLUDED.name,
    current_price = EXCLUDED.current_price,
    description = EXCLUDED.description;

-- 4. Histórico Inmutable de Precios (Redundancia Controlada)
INSERT INTO directory.plan_price_history (
    id, plan_id, price, currency, effective_from, effective_to,
    changed_by_user_id, change_reason, is_promotional
) VALUES (
    'f2000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001',
    45.00,
    'USD',
    now() - interval '30 days',
    NULL,
    (SELECT id FROM usuarios LIMIT 1),
    'Tarifa estándar oficial de temporada',
    false
), (
    'f2000000-0000-4000-8000-000000000002',
    'f1000000-0000-4000-8000-000000000002',
    120.00,
    'USD',
    now() - interval '30 days',
    NULL,
    (SELECT id FROM usuarios LIMIT 1),
    'Precio promocional trimestral con 15% de descuento',
    true
) ON CONFLICT (id) DO NOTHING;

-- 5. Reseñas App Store
INSERT INTO directory.reviews (
    id, entity_id, user_id, rating, title, body, is_verified_athlete,
    helpful_count, status
) VALUES (
    'f3000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    (SELECT id FROM usuarios LIMIT 1),
    5,
    'El mejor gimnasio de la ciudad sin duda',
    'Las máquinas son de primer nivel y la zona de sentadillas siempre tiene barras olímpicas disponibles. Muy limpio y los vestuarios impecables.',
    true,
    8,
    'PUBLISHED'
) ON CONFLICT (entity_id, user_id) DO NOTHING;

-- 6. Respuesta Oficial del Dueño
INSERT INTO directory.review_replies (
    id, review_id, author_id, reply_text
) VALUES (
    'f4000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000001',
    (SELECT id FROM usuarios LIMIT 1),
    '¡Muchas gracias por tu comentario! Nos alegra que disfrutes el equipamiento Eleiko y las instalaciones. ¡A seguir rompiendo récords!'
) ON CONFLICT (review_id) DO NOTHING;

COMMIT;
