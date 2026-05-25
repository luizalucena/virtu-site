/* ============================================================
   VIRTÙ — Supabase Configuration
   Substitua os valores abaixo pelas suas credenciais do Supabase
   Encontre em: supabase.com → seu projeto → Settings → API
   ============================================================ */

const SUPABASE_URL = 'https://oxivtnuxnghpddwawfdr.supabase.co/rest/v1/';
// Exemplo: 'https://abcdefghij.supabase.co'

const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94aXZ0bnV4bmdocGRkd2F3ZmRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjUxMjYsImV4cCI6MjA5NTMwMTEyNn0.C6KgUunebmFrOnfp5nT49JdxBZviC4DegGfHlj2JU2I';
// Exemplo: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

// ── Inicializa o cliente (disponível globalmente) ─────────────
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
