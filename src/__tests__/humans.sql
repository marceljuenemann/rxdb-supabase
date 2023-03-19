--
-- Table required for integration test against real supabase instance
--

CREATE TABLE public.humans (
    id text NOT NULL,
    name text NOT NULL,
    age smallint,
    _deleted boolean DEFAULT false NOT NULL,
    _modified timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.humans OWNER TO postgres;

ALTER TABLE ONLY public.humans
    ADD CONSTRAINT humans_pkey PRIMARY KEY (id);

CREATE TRIGGER update_modified_datetime BEFORE UPDATE ON public.humans FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('_modified');

GRANT ALL ON TABLE public.humans TO anon;
GRANT ALL ON TABLE public.humans TO authenticated;
GRANT ALL ON TABLE public.humans TO service_role;
