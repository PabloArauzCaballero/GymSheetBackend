import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Directorio Multientidad (GYM, Centros, Coaches, Tiendas de Nutrición, Equipamiento)
 * y Sistema de Calificación y Reseñas estilo App Store con Árbol de Categorías Jerárquico.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS directory`,

  // 1. Árbol Jerárquico de Categorías (Adjacency List + Materialized Path)
  `CREATE TABLE directory.categories (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     parent_id uuid REFERENCES directory.categories(id) ON DELETE CASCADE,
     slug varchar(80) NOT NULL UNIQUE,
     path text NOT NULL,
     name varchar(100) NOT NULL,
     description text,
     icon_key varchar(50),
     entity_scope varchar(30) NOT NULL DEFAULT 'ALL',
     display_order integer NOT NULL DEFAULT 0,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_directory_category_scope CHECK (entity_scope IN ('GYM', 'COACH', 'CENTER', 'STORE', 'SERVICE_PROVIDER', 'ALL'))
   )`,

  `CREATE INDEX ix_directory_categories_parent ON directory.categories(parent_id)`,
  `CREATE INDEX ix_directory_categories_path ON directory.categories(path varchar_pattern_ops)`,
  `CREATE INDEX ix_directory_categories_scope ON directory.categories(entity_scope, display_order)`,

  // 2. Entidades del Directorio (Tiendas, Gimnasios, Coaches, Centros, etc.)
  `CREATE TABLE directory.entities (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     slug varchar(120) NOT NULL UNIQUE,
     entity_type varchar(30) NOT NULL,
     name varchar(180) NOT NULL,
     headline varchar(255),
     description text NOT NULL,
     primary_category_id uuid NOT NULL REFERENCES directory.categories(id) ON DELETE RESTRICT,
     tenant_id varchar(60) REFERENCES public.tenants(id) ON DELETE SET NULL,
     user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     branch_id uuid REFERENCES facilities.branches(id) ON DELETE SET NULL,
     logo_url text,
     cover_url text,
     gallery jsonb NOT NULL DEFAULT '[]'::jsonb,
     is_online_only boolean NOT NULL DEFAULT false,
     address text,
     city varchar(100),
     country varchar(60),
     latitude numeric(9,6),
     longitude numeric(9,6),
     contact_info jsonb NOT NULL DEFAULT '{}'::jsonb,
     business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
     rating_average numeric(3,2) NOT NULL DEFAULT 0.00,
     rating_count integer NOT NULL DEFAULT 0,
     rating_breakdown jsonb NOT NULL DEFAULT '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb,
     is_verified boolean NOT NULL DEFAULT false,
     status varchar(20) NOT NULL DEFAULT 'ACTIVE',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_directory_entity_type CHECK (entity_type IN ('GYM', 'COACH', 'CENTER', 'STORE', 'SERVICE_PROVIDER')),
     CONSTRAINT ck_directory_entity_status CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'SUSPENDED')),
     CONSTRAINT ck_directory_rating_avg CHECK (rating_average BETWEEN 0 AND 5)
   )`,

  `CREATE INDEX ix_directory_entities_type_status ON directory.entities(entity_type, status)`,
  `CREATE INDEX ix_directory_entities_primary_cat ON directory.entities(primary_category_id)`,
  `CREATE INDEX ix_directory_entities_rating ON directory.entities(rating_average DESC, rating_count DESC)`,
  `CREATE INDEX ix_directory_entities_geo ON directory.entities(latitude, longitude) WHERE latitude IS NOT NULL`,

  // 3. Categorías Secundarias (M:N)
  `CREATE TABLE directory.entity_categories (
     entity_id uuid NOT NULL REFERENCES directory.entities(id) ON DELETE CASCADE,
     category_id uuid NOT NULL REFERENCES directory.categories(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (entity_id, category_id)
   )`,
  `CREATE INDEX ix_directory_entity_categories_cat ON directory.entity_categories(category_id)`,

  // 4. Reseñas Atómicas Estilo App Store
  `CREATE TABLE directory.reviews (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     entity_id uuid NOT NULL REFERENCES directory.entities(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     rating smallint NOT NULL,
     title varchar(120) NOT NULL,
     body text NOT NULL,
     is_verified_athlete boolean NOT NULL DEFAULT false,
     experience_date date,
     helpful_count integer NOT NULL DEFAULT 0,
     status varchar(20) NOT NULL DEFAULT 'PUBLISHED',
     edited_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_directory_review_user_entity UNIQUE (entity_id, user_id),
     CONSTRAINT ck_directory_review_rating CHECK (rating BETWEEN 1 AND 5),
     CONSTRAINT ck_directory_review_status CHECK (status IN ('PUBLISHED', 'FLAGGED', 'HIDDEN', 'DELETED'))
   )`,

  `CREATE INDEX ix_directory_reviews_entity_published ON directory.reviews(entity_id, created_at DESC) WHERE status = 'PUBLISHED'`,
  `CREATE INDEX ix_directory_reviews_entity_helpful ON directory.reviews(entity_id, helpful_count DESC) WHERE status = 'PUBLISHED'`,
  `CREATE INDEX ix_directory_reviews_user ON directory.reviews(user_id, created_at DESC)`,

  // 5. Respuesta Oficial del Propietario / Desarrollador
  `CREATE TABLE directory.review_replies (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     review_id uuid NOT NULL UNIQUE REFERENCES directory.reviews(id) ON DELETE CASCADE,
     author_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     reply_text text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,

  // 6. Votos Útiles ("¿Te resultó útil?")
  `CREATE TABLE directory.review_helpful_votes (
     review_id uuid NOT NULL REFERENCES directory.reviews(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (review_id, user_id)
   )`,

  // 7. Trigger para Sincronización Automática O(1) de Métricas e Histograma App Store
  `CREATE OR REPLACE FUNCTION directory.fn_sync_entity_rating_metrics()
   RETURNS TRIGGER AS $$
   DECLARE
     target_entity_id uuid;
     new_avg numeric(3,2);
     new_count integer;
     new_breakdown jsonb;
   BEGIN
     IF TG_OP = 'DELETE' THEN
       target_entity_id := OLD.entity_id;
     ELSE
       target_entity_id := NEW.entity_id;
     END IF;

     SELECT 
       COALESCE(ROUND(AVG(rating)::numeric, 2), 0.00),
       COUNT(*),
       jsonb_build_object(
         '1', COUNT(*) FILTER (WHERE rating = 1),
         '2', COUNT(*) FILTER (WHERE rating = 2),
         '3', COUNT(*) FILTER (WHERE rating = 3),
         '4', COUNT(*) FILTER (WHERE rating = 4),
         '5', COUNT(*) FILTER (WHERE rating = 5)
       )
     INTO new_avg, new_count, new_breakdown
     FROM directory.reviews
     WHERE entity_id = target_entity_id AND status = 'PUBLISHED';

     UPDATE directory.entities
     SET 
       rating_average = new_avg,
       rating_count = new_count,
       rating_breakdown = new_breakdown,
       updated_at = now()
     WHERE id = target_entity_id;

     RETURN NULL;
   END;
   $$ LANGUAGE plpgsql`,

  `CREATE TRIGGER trg_sync_entity_rating
   AFTER INSERT OR UPDATE OR DELETE ON directory.reviews
   FOR EACH ROW EXECUTE FUNCTION directory.fn_sync_entity_rating_metrics()`,

  // 8. Semilla del Árbol de Categorías Base
  // Raíces
  `INSERT INTO directory.categories (id, parent_id, slug, path, name, description, icon_key, entity_scope, display_order)
   VALUES
     ('a1000000-0000-0000-0000-000000000001', NULL, 'tiendas', 'tiendas', 'Tiendas y Marcas', 'Tiendas de nutrición, suplementos, ropa y equipamiento de gimnasio', 'store', 'STORE', 10),
     ('a1000000-0000-0000-0000-000000000002', NULL, 'gimnasios', 'gimnasios', 'Gimnasios y Cadenas', 'Gimnasios comerciales, 24 horas y tradicionales', 'dumbbell', 'GYM', 20),
     ('a1000000-0000-0000-0000-000000000003', NULL, 'centros', 'centros', 'Centros Especializados', 'Boxes de CrossFit, estudios de pilates, yoga y artes marciales', 'flame', 'CENTER', 30),
     ('a1000000-0000-0000-0000-000000000004', NULL, 'coaches', 'coaches', 'Coaches y Nutricionistas', 'Entrenadores personales certificados, preparadores y nutricionistas', 'award', 'COACH', 40),
     ('a1000000-0000-0000-0000-000000000005', NULL, 'servicios', 'servicios', 'Servicios de Salud y Recuperación', 'Fisioterapia deportiva, masajes, crioterapia y meal prep', 'heart', 'SERVICE_PROVIDER', 50)
   ON CONFLICT (slug) DO NOTHING`,

  // Subcategorías de Tiendas (Nutrición y Equipamiento)
  `INSERT INTO directory.categories (id, parent_id, slug, path, name, description, icon_key, entity_scope, display_order)
   VALUES
     ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'tiendas-nutricion', 'tiendas.nutricion', 'Nutrición y Suplementos', 'Proteínas, creatinas, pre-entrenos y vitaminas', 'flask', 'STORE', 1),
     ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'tiendas-equipamiento', 'tiendas.equipamiento', 'Aparatos y Equipamiento de Gym', 'Máquinas de fuerza, cardio, peso libre y jaulas', 'layers', 'STORE', 2),
     ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'tiendas-indumentaria', 'tiendas.indumentaria', 'Indumentaria y Calzado', 'Ropa técnica, calzado de halterofilia y powerlifting', 'shirt', 'STORE', 3)
   ON CONFLICT (slug) DO NOTHING`,

  // Hojas de Nutrición
  `INSERT INTO directory.categories (id, parent_id, slug, path, name, description, icon_key, entity_scope, display_order)
   VALUES
     ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'proteinas', 'tiendas.nutricion.proteinas', 'Proteínas y Aminoácidos', 'Whey protein, aisladas, caseína y proteínas vegetales', 'sparkles', 'STORE', 1),
     ('c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'creatinas', 'tiendas.nutricion.creatinas', 'Creatinas y Rendimiento', 'Monohidrato, creapure y pre-entrenos estimulantes', 'zap', 'STORE', 2),
     ('c1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 'snacks-saludables', 'tiendas.nutricion.snacks', 'Snacks y Barras Proteicas', 'Barras, mantequillas de maní y bebidas energéticas', 'coffee', 'STORE', 3)
   ON CONFLICT (slug) DO NOTHING`,

  // Hojas de Equipamiento
  `INSERT INTO directory.categories (id, parent_id, slug, path, name, description, icon_key, entity_scope, display_order)
   VALUES
     ('c1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000002', 'maquinaria-fuerza', 'tiendas.equipamiento.fuerza', 'Maquinaria de Fuerza y Racks', 'Prensas, poleas guiadas, jaulas de potencia y bancos', 'grid', 'STORE', 1),
     ('c1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000002', 'peso-libre', 'tiendas.equipamiento.peso-libre', 'Peso Libre y Barras', 'Mancuernas hexagonales, discos olímpicos, kettlebells y barras', 'disc', 'STORE', 2),
     ('c1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000002', 'accesorios-gym', 'tiendas.equipamiento.accesorios', 'Accesorios de Levantamiento', 'Straps, cinturones lumbares, rodilleras y muñequeras', 'shield', 'STORE', 3)
   ON CONFLICT (slug) DO NOTHING`,
] as const;

const downStatements = [
  `DROP TRIGGER IF EXISTS trg_sync_entity_rating ON directory.reviews`,
  `DROP FUNCTION IF EXISTS directory.fn_sync_entity_rating_metrics()`,
  `DROP TABLE IF EXISTS directory.review_helpful_votes`,
  `DROP TABLE IF EXISTS directory.review_replies`,
  `DROP TABLE IF EXISTS directory.reviews`,
  `DROP TABLE IF EXISTS directory.entity_categories`,
  `DROP TABLE IF EXISTS directory.entities`,
  `DROP TABLE IF EXISTS directory.categories`,
  `DROP SCHEMA IF EXISTS directory CASCADE`,
] as const;

export const directoryAndAppstoreReviewsMigration: DatabaseMigration = {
  id: '202610190001-directory-and-appstore-reviews',
  description:
    'Directorio unificado de oferentes (tiendas de nutrición/equipamiento, gyms, coaches, centros) con árbol de categorías y sistema de reseñas estilo App Store.',
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
