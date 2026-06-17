-- ============================================================
-- GYMSHEET
-- PostgreSQL DDL
-- VERSION CHECK CONSTRAINTS (SIN ENUMS)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USUARIOS
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    email VARCHAR(180) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nombre_completo VARCHAR(180) NOT NULL,

    rol VARCHAR(30) NOT NULL DEFAULT 'CLIENTE',
    estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',

    fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_usuarios_rol
        CHECK (
            rol IN (
                'ADMIN',
                'CLIENTE',
                'ENTRENADOR_EXTERNO'
            )
        ),

    CONSTRAINT ck_usuarios_estado
        CHECK (
            estado IN (
                'ACTIVO',
                'INACTIVO'
            )
        )
);

-- ============================================================
-- PERFILES ANTROPOMÉTRICOS
-- ============================================================

CREATE TABLE IF NOT EXISTS perfiles_antropometricos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    usuario_id UUID NOT NULL UNIQUE
        REFERENCES usuarios(id)
        ON DELETE CASCADE,

    edad INTEGER NOT NULL
        CHECK (edad BETWEEN 12 AND 100),

    peso_kg NUMERIC(6,2) NOT NULL
        CHECK (peso_kg > 0),

    estatura_cm INTEGER NOT NULL
        CHECK (estatura_cm BETWEEN 80 AND 250),

    objetivo VARCHAR(30) NOT NULL,

    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_perfiles_objetivo
        CHECK (
            objetivo IN (
                'HIPERTROFIA',
                'FUERZA',
                'RESISTENCIA',
                'PERDIDA_GRASA',
                'SALUD_GENERAL',
                'REHABILITACION'
            )
        )
);

-- ============================================================
-- EQUIPOS DEL GIMNASIO
-- ============================================================

CREATE TABLE IF NOT EXISTS equipos_gym (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    nombre VARCHAR(140) NOT NULL,

    tipo VARCHAR(30) NOT NULL,

    descripcion TEXT,

    estado VARCHAR(30) NOT NULL DEFAULT 'DISPONIBLE',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_equipo_tipo
        CHECK (
            tipo IN (
                'MAQUINA',
                'MANCUERNA',
                'BARRA',
                'DISCO',
                'BANCO',
                'POLEA',
                'BANDA',
                'ACCESORIO',
                'OTRO'
            )
        ),

    CONSTRAINT ck_equipo_estado
        CHECK (
            estado IN (
                'DISPONIBLE',
                'MANTENIMIENTO',
                'INACTIVO'
            )
        )
);

-- ============================================================
-- EJERCICIOS
-- ============================================================

CREATE TABLE IF NOT EXISTS ejercicios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    nombre VARCHAR(160) NOT NULL,

    grupo_muscular VARCHAR(100) NOT NULL,

    descripcion TEXT,

    tipo_ejercicio VARCHAR(20) NOT NULL,

    created_by_usuario_id UUID
        REFERENCES usuarios(id)
        ON DELETE SET NULL,

    estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_ejercicio_tipo
        CHECK (
            tipo_ejercicio IN (
                'GLOBAL',
                'PERSONAL'
            )
        ),

    CONSTRAINT ck_ejercicio_estado
        CHECK (
            estado IN (
                'ACTIVO',
                'INACTIVO'
            )
        ),

    CONSTRAINT ck_ejercicio_global_o_personal
        CHECK (
            (
                tipo_ejercicio = 'GLOBAL'
                AND created_by_usuario_id IS NULL
            )
            OR
            (
                tipo_ejercicio = 'PERSONAL'
                AND created_by_usuario_id IS NOT NULL
            )
        )
);

-- ============================================================
-- RELACIÓN EJERCICIOS - EQUIPOS
-- ============================================================

CREATE TABLE IF NOT EXISTS ejercicios_equipos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    ejercicio_id UUID NOT NULL
        REFERENCES ejercicios(id)
        ON DELETE CASCADE,

    equipo_gym_id UUID NOT NULL
        REFERENCES equipos_gym(id)
        ON DELETE RESTRICT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_ejercicios_equipos
        UNIQUE (
            ejercicio_id,
            equipo_gym_id
        )
);

-- ============================================================
-- EJERCICIOS SELECCIONADOS POR USUARIO
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios_ejercicios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    usuario_id UUID NOT NULL
        REFERENCES usuarios(id)
        ON DELETE CASCADE,

    ejercicio_id UUID NOT NULL
        REFERENCES ejercicios(id)
        ON DELETE RESTRICT,

    fecha_seleccion TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_usuarios_ejercicios
        UNIQUE (
            usuario_id,
            ejercicio_id
        )
);

-- ============================================================
-- SESIONES DE ENTRENAMIENTO
-- ============================================================

CREATE TABLE IF NOT EXISTS sesiones_entrenamiento (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    usuario_id UUID NOT NULL
        REFERENCES usuarios(id)
        ON DELETE CASCADE,

    fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    fecha_fin TIMESTAMPTZ,

    estado VARCHAR(30) NOT NULL DEFAULT 'EN_PROGRESO',

    observacion TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_sesion_estado
        CHECK (
            estado IN (
                'EN_PROGRESO',
                'FINALIZADA',
                'CANCELADA'
            )
        ),

    CONSTRAINT ck_sesion_fechas
        CHECK (
            fecha_fin IS NULL
            OR fecha_fin >= fecha_inicio
        )
);

-- ============================================================
-- EJERCICIOS EJECUTADOS EN UNA SESIÓN
-- ============================================================

CREATE TABLE IF NOT EXISTS sesiones_ejercicios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    sesion_id UUID NOT NULL
        REFERENCES sesiones_entrenamiento(id)
        ON DELETE CASCADE,

    ejercicio_id UUID NOT NULL
        REFERENCES ejercicios(id)
        ON DELETE RESTRICT,

    orden INTEGER NOT NULL
        CHECK (orden > 0),

    es_enfasis BOOLEAN NOT NULL DEFAULT FALSE,

    nota TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_sesion_ejercicio_orden
        UNIQUE (
            sesion_id,
            orden
        )
);

-- ============================================================
-- SERIES DE ENTRENAMIENTO
-- ============================================================

CREATE TABLE IF NOT EXISTS series_entrenamiento (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    sesion_ejercicio_id UUID NOT NULL
        REFERENCES sesiones_ejercicios(id)
        ON DELETE CASCADE,

    numero_serie INTEGER NOT NULL
        CHECK (numero_serie > 0),

    repeticiones INTEGER NOT NULL
        CHECK (repeticiones > 0),

    peso_kg NUMERIC(7,2) NOT NULL
        CHECK (
            peso_kg >= 0
            AND peso_kg <= 1000
        ),

    rir INTEGER NOT NULL
        CHECK (
            rir BETWEEN 0 AND 10
        ),

    descanso_seg_anterior INTEGER NOT NULL
        CHECK (
            descanso_seg_anterior >= 0
        ),

    fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_serie_por_ejercicio_sesion
        UNIQUE (
            sesion_ejercicio_id,
            numero_serie
        )
);

-- ============================================================
-- ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_usuarios_email
ON usuarios(email);

CREATE INDEX IF NOT EXISTS idx_ejercicios_visibilidad
ON ejercicios(
    estado,
    tipo_ejercicio,
    created_by_usuario_id
);

CREATE INDEX IF NOT EXISTS idx_usuarios_ejercicios_usuario
ON usuarios_ejercicios(usuario_id);

CREATE INDEX IF NOT EXISTS idx_sesiones_usuario_fecha
ON sesiones_entrenamiento(
    usuario_id,
    fecha_inicio DESC
);

CREATE INDEX IF NOT EXISTS idx_sesiones_estado
ON sesiones_entrenamiento(estado);

CREATE INDEX IF NOT EXISTS idx_sesiones_ejercicios_sesion
ON sesiones_ejercicios(sesion_id);

CREATE INDEX IF NOT EXISTS idx_series_sesion_ejercicio
ON series_entrenamiento(
    sesion_ejercicio_id,
    numero_serie
);

-- ============================================================
-- FUTURA FASE 2
-- ANALÍTICA Y EVENTOS
-- (NO IMPLEMENTADA AÚN)
-- ============================================================
--
-- eventos_sistema
-- dashboards
-- récords personales
-- rutinas
-- notificaciones
-- detección de abandono
--
-- ============================================================