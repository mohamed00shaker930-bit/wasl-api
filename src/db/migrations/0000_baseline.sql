
-- Dumped from database version 17.9
-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)

SET check_function_bodies = false;





CREATE TYPE public.app_role AS ENUM (
    'customer',
    'merchant',
    'super_admin',
    'admin',
    'operations',
    'support',
    'finance'
);


CREATE TYPE public.credit_status AS ENUM (
    'pending',
    'approved',
    'declined'
);


CREATE TYPE public.credit_tx_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


CREATE TYPE public.credit_tx_type AS ENUM (
    'charge',
    'payment'
);


CREATE TYPE public.custom_request_status AS ENUM (
    'pending',
    'quoted',
    'accepted',
    'rejected',
    'converted'
);


CREATE TYPE public.order_channel AS ENUM (
    'online',
    'in_store'
);


CREATE TYPE public.order_status AS ENUM (
    'sent',
    'accepted',
    'preparing',
    'out_for_delivery',
    'delivered',
    'declined',
    'cancelled'
);


CREATE TYPE public.payment_method AS ENUM (
    'cash',
    'credit',
    'jeeb',
    'jawali',
    'hasab',
    'onecash',
    'wallet'
);


CREATE TYPE public.return_status AS ENUM (
    'none',
    'requested',
    'approved',
    'rejected'
);


CREATE TYPE public.store_status AS ENUM (
    'pending',
    'active',
    'suspended',
    'rejected'
);


CREATE TYPE public.wallet_tx_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


CREATE TYPE public.wallet_tx_type AS ENUM (
    'topup',
    'payment',
    'refund',
    'adjustment'
);


CREATE FUNCTION public.app_events_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_users uuid[]; v_type text; v_row record; v_owner uuid;
BEGIN
  v_row := COALESCE(NEW, OLD);
  IF TG_TABLE_NAME = 'notifications' THEN
    v_type := 'notification.created'; v_users := ARRAY[v_row.user_id];
  ELSIF TG_TABLE_NAME = 'orders' THEN
    v_type := CASE WHEN TG_OP = 'INSERT' THEN 'order.created' ELSE 'order.updated' END;
    SELECT owner_id INTO v_owner FROM public.stores WHERE id = v_row.store_id;
    v_users := ARRAY_REMOVE(ARRAY[v_row.customer_id, v_owner], NULL);
  ELSIF TG_TABLE_NAME = 'credit_transactions' THEN
    v_type := 'credit_tx.updated';
    SELECT ARRAY_REMOVE(ARRAY[a.customer_id, s.owner_id], NULL) INTO v_users
      FROM public.credit_accounts a JOIN public.stores s ON s.id = a.store_id WHERE a.id = v_row.account_id;
  ELSIF TG_TABLE_NAME = 'wallet_transactions' THEN
    v_type := 'wallet_tx.updated'; v_users := ARRAY[v_row.user_id];
  ELSE
    RETURN NULL;
  END IF;
  PERFORM pg_notify('app_events', json_build_object(
    'type', v_type, 'table', TG_TABLE_NAME, 'op', TG_OP, 'id', v_row.id, 'user_ids', v_users, 'at', now())::text);
  RETURN NULL;
END $$;


CREATE FUNCTION public.calc_order_commission() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE v_pct numeric;
BEGIN
  IF NEW.commission_pct IS NULL OR NEW.commission_pct = 0 THEN
    SELECT commission_pct INTO v_pct FROM public.stores WHERE id = NEW.store_id;
    IF v_pct IS NULL THEN
      SELECT (value)::text::numeric INTO v_pct FROM public.app_settings WHERE key = 'default_commission_pct';
    END IF;
    NEW.commission_pct := COALESCE(v_pct, 0);
  END IF;
  NEW.commission_amount := ROUND(COALESCE(NEW.total,0) * NEW.commission_pct / 100, 2);
  RETURN NEW;
END $$;


CREATE FUNCTION public.catalog_category_counts() RETURNS TABLE(category_id uuid, items_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT category_id, count(*)::bigint FROM public.catalog_items GROUP BY category_id
$$;


CREATE FUNCTION public.claim_pending_customers() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    UPDATE public.pending_customers
       SET claimed_by_user_id = NEW.id
     WHERE phone = NEW.phone AND claimed_by_user_id IS NULL;
  END IF;
  RETURN NEW;
END $$;


CREATE FUNCTION public.credit_tx_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'credit_transactions is append-only (delete of % refused)', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'credit_transactions is append-only (only status/note may change)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'approved' AND NEW.status <> 'approved' THEN
    RAISE EXCEPTION 'an approved credit entry cannot be un-approved' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;


CREATE FUNCTION public.notify_order_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE v_store_name TEXT; v_owner UUID;
BEGIN
  SELECT name, owner_id INTO v_store_name, v_owner FROM public.stores WHERE id = NEW.store_id;
  IF TG_OP = 'INSERT' THEN
    IF v_owner IS NOT NULL THEN
      PERFORM public.push_notification(v_owner, 'طلب جديد', 'وصلك طلب جديد بقيمة ' || NEW.total::TEXT || ' ر.ي', 'order', '/merchant/orders');
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.push_notification(
      NEW.customer_id,
      'تحديث طلبك من ' || COALESCE(v_store_name,''),
      'الحالة الجديدة: ' || NEW.status::TEXT,
      'order', '/orders'
    );
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.return_status IS DISTINCT FROM NEW.return_status AND NEW.return_status IN ('approved','rejected') THEN
    PERFORM public.push_notification(
      NEW.customer_id,
      'طلب الإرجاع: ' || CASE WHEN NEW.return_status='approved' THEN 'تمت الموافقة' ELSE 'مرفوض' END,
      'طلبك من ' || COALESCE(v_store_name,''),
      'return', '/orders'
    );
  END IF;
  RETURN NEW;
END $$;


CREATE FUNCTION public.push_notification(_user_id uuid, _title text, _body text, _type text, _link text) RETURNS void
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  INSERT INTO public.notifications(user_id, title, body, type, link) VALUES (_user_id, _title, _body, _type, _link);
$$;


CREATE FUNCTION public.recalc_order_total() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_order uuid; v_total numeric;
BEGIN
  v_order := COALESCE(NEW.order_id, OLD.order_id);
  SELECT COALESCE(SUM(price * qty), 0) INTO v_total FROM public.order_items WHERE order_id = v_order;
  UPDATE public.orders
     SET total = v_total,
         commission_amount = ROUND(v_total * COALESCE(commission_pct, 0) / 100, 2),
         updated_at = now()
   WHERE id = v_order;
  RETURN COALESCE(NEW, OLD);
END $$;


CREATE FUNCTION public.sync_category_to_catalog() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.catalog_categories (name, usage_count)
  VALUES (NEW.name, 1)
  ON CONFLICT (lower(name))
  DO UPDATE SET usage_count = public.catalog_categories.usage_count + 1;
  RETURN NEW;
END $$;


CREATE FUNCTION public.sync_product_to_catalog() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE cat_name TEXT;
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT name INTO cat_name FROM public.categories WHERE id = NEW.category_id;
  END IF;
  INSERT INTO public.catalog_items (name, default_price, image_url, barcode, category_name, source, usage_count)
  VALUES (NEW.name, COALESCE(NEW.price, 0), NEW.image_url, NEW.barcode, cat_name, 'merchant', 1)
  ON CONFLICT (lower(name), COALESCE(barcode, ''))
  DO UPDATE SET
    usage_count = public.catalog_items.usage_count + 1,
    image_url = COALESCE(public.catalog_items.image_url, EXCLUDED.image_url),
    category_name = COALESCE(public.catalog_items.category_name, EXCLUDED.category_name);
  IF cat_name IS NOT NULL THEN
    INSERT INTO public.catalog_categories (name, usage_count)
    VALUES (cat_name, 1)
    ON CONFLICT (lower(name))
    DO UPDATE SET usage_count = public.catalog_categories.usage_count + 1;
  END IF;
  RETURN NEW;
END $$;


CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;


CREATE FUNCTION public.update_store_rating() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.stores SET
    rating_count = (SELECT COUNT(*) FROM public.ratings WHERE store_id = NEW.store_id),
    rating = (SELECT COALESCE(AVG(stars),0) FROM public.ratings WHERE store_id = NEW.store_id)
  WHERE id = NEW.store_id;
  RETURN NEW;
END $$;


SET default_tablespace = '';


CREATE TABLE public.admin_permissions (
    user_id uuid NOT NULL,
    permission text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.app_usage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seq bigint NOT NULL,
    user_id uuid NOT NULL,
    user_agent text,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    last_ping_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    close_type text
);


ALTER TABLE public.app_usage_log ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.app_usage_log_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seq bigint NOT NULL,
    user_id uuid,
    user_name text,
    user_role text,
    action text NOT NULL,
    table_name text NOT NULL,
    record_id text,
    record_label text,
    old_data jsonb,
    new_data jsonb,
    changed_fields text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.audit_logs ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_logs_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE public.auth_sessions_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seq bigint NOT NULL,
    user_id uuid NOT NULL,
    session_id text NOT NULL,
    ip text,
    user_agent text,
    login_at timestamp with time zone DEFAULT now() NOT NULL,
    logout_at timestamp with time zone,
    logout_type text,
    last_seen_at timestamp with time zone
);


ALTER TABLE public.auth_sessions_log ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.auth_sessions_log_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE public.banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    subtitle text,
    image_url text,
    link text,
    bg_color text DEFAULT '#0d9488'::text,
    store_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.business_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name_ar text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.catalog_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    icon text,
    usage_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text,
    main_section text,
    parent_category text,
    sort_order integer DEFAULT 0 NOT NULL
);


CREATE TABLE public.catalog_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    default_price numeric(12,2) DEFAULT 0 NOT NULL,
    image_url text,
    barcode text,
    category_name text,
    usage_count integer DEFAULT 0 NOT NULL,
    source text DEFAULT 'merchant'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category_id uuid,
    category_path text,
    description text DEFAULT ''::text NOT NULL,
    main_section text,
    subcategory text,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT catalog_items_source_check CHECK ((source = ANY (ARRAY['seed'::text, 'merchant'::text, 'library_import'::text])))
);


CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.credit_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    store_id uuid NOT NULL,
    balance numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credit_accounts_balance_nonneg CHECK ((balance >= (0)::numeric))
);


CREATE TABLE public.credit_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    type public.credit_tx_type NOT NULL,
    amount numeric(10,2) NOT NULL,
    note text,
    order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status public.credit_tx_status DEFAULT 'approved'::public.credit_tx_status NOT NULL,
    CONSTRAINT credit_transactions_amount_check CHECK ((amount > (0)::numeric))
);


CREATE TABLE public.custom_product_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    store_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    qty integer DEFAULT 1 NOT NULL,
    image_url text,
    merchant_price numeric,
    merchant_note text,
    status public.custom_request_status DEFAULT 'pending'::public.custom_request_status NOT NULL,
    order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.customer_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    store_id uuid NOT NULL,
    order_id uuid,
    stars integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_ratings_stars_check CHECK (((stars >= 1) AND (stars <= 5)))
);


CREATE TABLE public.device_tokens (
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_tokens_platform_check CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text, 'web'::text])))
);


CREATE TABLE public.favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT favorites_target_type_check CHECK ((target_type = ANY (ARRAY['store'::text, 'product'::text])))
);


CREATE TABLE public.locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label text NOT NULL,
    lat double precision,
    lng double precision,
    landmark_text text NOT NULL,
    phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text,
    type text DEFAULT 'info'::text NOT NULL,
    link text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    name text NOT NULL,
    price numeric(10,2) NOT NULL,
    qty integer NOT NULL,
    note text
);


CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    store_id uuid NOT NULL,
    total numeric(10,2) NOT NULL,
    payment_method public.payment_method NOT NULL,
    credit_status public.credit_status,
    status public.order_status DEFAULT 'sent'::public.order_status NOT NULL,
    note text,
    location_label text,
    location_landmark text,
    location_phone text,
    location_lat double precision,
    location_lng double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    channel public.order_channel DEFAULT 'online'::public.order_channel NOT NULL,
    return_status public.return_status DEFAULT 'none'::public.return_status NOT NULL,
    return_reason text,
    return_requested_at timestamp with time zone,
    return_responded_at timestamp with time zone,
    commission_pct numeric(5,2) DEFAULT 0 NOT NULL,
    commission_amount numeric(10,2) DEFAULT 0 NOT NULL
);


CREATE TABLE public.password_reset_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    user_id uuid,
    user_type text,
    applicant_name text,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by uuid,
    CONSTRAINT password_reset_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


CREATE TABLE public.pending_customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    created_by uuid NOT NULL,
    claimed_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.permission_bundle_items (
    bundle text NOT NULL,
    permission text NOT NULL
);


CREATE TABLE public.permission_bundles (
    bundle text NOT NULL,
    label text NOT NULL,
    sort integer DEFAULT 0 NOT NULL
);


CREATE TABLE public.permission_defs (
    perm text NOT NULL,
    grp text NOT NULL,
    grp_label text NOT NULL,
    label text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    super_only boolean DEFAULT false NOT NULL
);


CREATE TABLE public.pos_ingest_log (
    client_op_id uuid NOT NULL,
    store_id uuid NOT NULL,
    kind text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pos_ingest_log_kind_check CHECK ((kind = ANY (ARRAY['sale'::text, 'new_product'::text])))
);


COMMENT ON TABLE public.pos_ingest_log IS 'Idempotency record for offline POS envelopes keyed by the client-generated op id.';


CREATE TABLE public.product_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    store_id uuid NOT NULL,
    discount_price numeric NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone,
    max_qty integer,
    sold_qty integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    category_id uuid,
    name text NOT NULL,
    image_url text,
    price numeric(10,2) NOT NULL,
    in_stock boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    barcode text,
    lib_category text,
    main_section text,
    subcategory text
);


CREATE TABLE public.profiles (
    id uuid NOT NULL,
    phone text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    account_status text DEFAULT 'pending'::text NOT NULL,
    user_type text,
    business_name text,
    business_category_id uuid,
    city text,
    district text,
    address text,
    approved_at timestamp with time zone,
    approved_by uuid,
    suspended_until timestamp with time zone,
    status_reason text,
    CONSTRAINT profiles_account_status_check CHECK ((account_status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text, 'suspended'::text, 'deleted'::text])))
);


CREATE TABLE public.ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    store_id uuid NOT NULL,
    order_id uuid,
    stars integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ratings_stars_check CHECK (((stars >= 1) AND (stars <= 5)))
);


CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    family uuid NOT NULL,
    client text DEFAULT 'web'::text NOT NULL,
    user_agent text,
    ip text,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    replaced_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refresh_tokens_client_check CHECK ((client = ANY (ARRAY['web'::text, 'mobile'::text])))
);


CREATE TABLE public.stores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    area text,
    lat double precision,
    lng double precision,
    is_open boolean DEFAULT true NOT NULL,
    rating numeric(3,2) DEFAULT 0 NOT NULL,
    rating_count integer DEFAULT 0 NOT NULL,
    delivery_info text,
    phone text,
    image_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status public.store_status DEFAULT 'pending'::public.store_status NOT NULL,
    commission_pct numeric(5,2),
    business_category_id uuid
);


CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    email text,
    password_hash text NOT NULL,
    password_algo text DEFAULT 'bcrypt'::text NOT NULL,
    force_password_change boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone,
    disabled_at timestamp with time zone,
    CONSTRAINT users_password_algo_check CHECK ((password_algo = ANY (ARRAY['bcrypt'::text, 'argon2id'::text])))
);


COMMENT ON TABLE public.users IS 'Application users (replaces Supabase auth.users; same UUIDs). Passwords: bcrypt hashes migrated from Supabase, rehashed to argon2id on first successful login.';


CREATE TABLE public.wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wallet_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type public.wallet_tx_type NOT NULL,
    status public.wallet_tx_status DEFAULT 'pending'::public.wallet_tx_status NOT NULL,
    amount numeric NOT NULL,
    method text,
    reference text,
    note text,
    order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    balance numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallets_balance_nonneg CHECK ((balance >= (0)::numeric))
);


ALTER TABLE ONLY public.admin_permissions
    ADD CONSTRAINT admin_permissions_pkey PRIMARY KEY (user_id, permission);


ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


ALTER TABLE ONLY public.app_usage_log
    ADD CONSTRAINT app_usage_log_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.auth_sessions_log
    ADD CONSTRAINT auth_sessions_log_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.banners
    ADD CONSTRAINT banners_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.business_categories
    ADD CONSTRAINT business_categories_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.business_categories
    ADD CONSTRAINT business_categories_slug_key UNIQUE (slug);


ALTER TABLE ONLY public.catalog_categories
    ADD CONSTRAINT catalog_categories_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.catalog_items
    ADD CONSTRAINT catalog_items_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.credit_accounts
    ADD CONSTRAINT credit_accounts_customer_id_store_id_key UNIQUE (customer_id, store_id);


ALTER TABLE ONLY public.credit_accounts
    ADD CONSTRAINT credit_accounts_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.custom_product_requests
    ADD CONSTRAINT custom_product_requests_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.customer_ratings
    ADD CONSTRAINT customer_ratings_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.customer_ratings
    ADD CONSTRAINT customer_ratings_store_id_order_id_key UNIQUE (store_id, order_id);


ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (user_id, token);


ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_target_type_target_id_key UNIQUE (user_id, target_type, target_id);


ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.password_reset_requests
    ADD CONSTRAINT password_reset_requests_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.pending_customers
    ADD CONSTRAINT pending_customers_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.permission_bundle_items
    ADD CONSTRAINT permission_bundle_items_pkey PRIMARY KEY (bundle, permission);


ALTER TABLE ONLY public.permission_bundles
    ADD CONSTRAINT permission_bundles_pkey PRIMARY KEY (bundle);


ALTER TABLE ONLY public.permission_defs
    ADD CONSTRAINT permission_defs_pkey PRIMARY KEY (perm);


ALTER TABLE ONLY public.pos_ingest_log
    ADD CONSTRAINT pos_ingest_log_pkey PRIMARY KEY (client_op_id);


ALTER TABLE ONLY public.product_offers
    ADD CONSTRAINT product_offers_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_key UNIQUE (user_id);


CREATE INDEX app_usage_log_user_idx ON public.app_usage_log USING btree (user_id, opened_at DESC);


CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at DESC);


CREATE INDEX audit_logs_table_name_idx ON public.audit_logs USING btree (table_name, created_at DESC);


CREATE INDEX audit_logs_user_id_idx ON public.audit_logs USING btree (user_id, created_at DESC);


CREATE INDEX auth_sessions_log_user_idx ON public.auth_sessions_log USING btree (user_id, login_at DESC);


CREATE UNIQUE INDEX catalog_categories_name_uniq ON public.catalog_categories USING btree (lower(name));


CREATE INDEX catalog_items_category_id_idx ON public.catalog_items USING btree (category_id);


CREATE UNIQUE INDEX catalog_items_dedup_uniq ON public.catalog_items USING btree (lower(name), COALESCE(barcode, ''::text));


CREATE INDEX credit_accounts_store_idx ON public.credit_accounts USING btree (store_id);


CREATE INDEX credit_transactions_account_created_idx ON public.credit_transactions USING btree (account_id, created_at);


CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, read_at, created_at DESC);


CREATE INDEX idx_product_offers_product ON public.product_offers USING btree (product_id);


CREATE INDEX idx_stores_latlng ON public.stores USING btree (lat, lng);


CREATE INDEX notifications_user_created_idx ON public.notifications USING btree (user_id, created_at DESC);


CREATE INDEX orders_customer_created_idx ON public.orders USING btree (customer_id, created_at DESC);


CREATE INDEX orders_store_created_idx ON public.orders USING btree (store_id, created_at DESC);


CREATE INDEX orders_store_status_created_idx ON public.orders USING btree (store_id, status, created_at DESC);


CREATE INDEX password_reset_requests_status_idx ON public.password_reset_requests USING btree (status, requested_at DESC);


CREATE INDEX pending_customers_phone_idx ON public.pending_customers USING btree (phone);


CREATE INDEX pending_customers_store_idx ON public.pending_customers USING btree (store_id);


CREATE UNIQUE INDEX products_store_barcode_uniq ON public.products USING btree (store_id, barcode) WHERE (barcode IS NOT NULL);


CREATE INDEX products_store_idx ON public.products USING btree (store_id);


CREATE INDEX profiles_account_status_idx ON public.profiles USING btree (account_status);


CREATE INDEX profiles_phone_idx ON public.profiles USING btree (phone);


CREATE INDEX refresh_tokens_family_idx ON public.refresh_tokens USING btree (family);


CREATE INDEX refresh_tokens_user_idx ON public.refresh_tokens USING btree (user_id);


CREATE INDEX wallet_transactions_user_created_idx ON public.wallet_transactions USING btree (user_id, created_at DESC);


CREATE TRIGGER calc_order_commission_trg BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.calc_order_commission();


CREATE TRIGGER claim_pending_customers_trg AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.claim_pending_customers();


CREATE TRIGGER touch_custom_requests BEFORE UPDATE ON public.custom_product_requests FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


CREATE TRIGGER trg_credit_tx_append_only BEFORE DELETE OR UPDATE ON public.credit_transactions FOR EACH ROW EXECUTE FUNCTION public.credit_tx_append_only();


CREATE TRIGGER trg_events_credit_tx AFTER INSERT OR UPDATE ON public.credit_transactions FOR EACH ROW EXECUTE FUNCTION public.app_events_notify();


CREATE TRIGGER trg_events_notifications AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.app_events_notify();


CREATE TRIGGER trg_events_orders AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.app_events_notify();


CREATE TRIGGER trg_events_wallet_tx AFTER INSERT OR UPDATE ON public.wallet_transactions FOR EACH ROW EXECUTE FUNCTION public.app_events_notify();


CREATE TRIGGER trg_notify_order_status AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.notify_order_status();


CREATE TRIGGER trg_recalc_order_total AFTER INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.recalc_order_total();


CREATE TRIGGER trg_sync_category_to_catalog AFTER INSERT ON public.categories FOR EACH ROW EXECUTE FUNCTION public.sync_category_to_catalog();


CREATE TRIGGER trg_sync_product_to_catalog AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.sync_product_to_catalog();


CREATE TRIGGER trg_update_store_rating AFTER INSERT ON public.ratings FOR EACH ROW EXECUTE FUNCTION public.update_store_rating();


ALTER TABLE ONLY public.admin_permissions
    ADD CONSTRAINT admin_permissions_permission_fkey FOREIGN KEY (permission) REFERENCES public.permission_defs(perm) ON DELETE CASCADE;


ALTER TABLE ONLY public.admin_permissions
    ADD CONSTRAINT admin_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.banners
    ADD CONSTRAINT banners_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.catalog_items
    ADD CONSTRAINT catalog_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.catalog_categories(id) ON DELETE SET NULL;


ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.credit_accounts
    ADD CONSTRAINT credit_accounts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.credit_accounts
    ADD CONSTRAINT credit_accounts_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.credit_accounts(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


ALTER TABLE ONLY public.custom_product_requests
    ADD CONSTRAINT custom_product_requests_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


ALTER TABLE ONLY public.custom_product_requests
    ADD CONSTRAINT custom_product_requests_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.customer_ratings
    ADD CONSTRAINT customer_ratings_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


ALTER TABLE ONLY public.customer_ratings
    ADD CONSTRAINT customer_ratings_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.pending_customers
    ADD CONSTRAINT pending_customers_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.permission_bundle_items
    ADD CONSTRAINT permission_bundle_items_bundle_fkey FOREIGN KEY (bundle) REFERENCES public.permission_bundles(bundle) ON DELETE CASCADE;


ALTER TABLE ONLY public.permission_bundle_items
    ADD CONSTRAINT permission_bundle_items_permission_fkey FOREIGN KEY (permission) REFERENCES public.permission_defs(perm) ON DELETE CASCADE;


ALTER TABLE ONLY public.pos_ingest_log
    ADD CONSTRAINT pos_ingest_log_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.product_offers
    ADD CONSTRAINT product_offers_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.product_offers
    ADD CONSTRAINT product_offers_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_business_category_id_fkey FOREIGN KEY (business_category_id) REFERENCES public.business_categories(id) ON DELETE SET NULL;


ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_business_category_id_fkey FOREIGN KEY (business_category_id) REFERENCES public.business_categories(id) ON DELETE SET NULL;


ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id) ON DELETE CASCADE;


ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



