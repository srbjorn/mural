// Mural na barra de tarefas: os compromissos mais próximos do mural, girando dentro da barra do Windows.
// Compila com o csc do .NET Framework 4 (C# 5), que já vem no Windows: veja tools/compilar-barra.ps1.
// Lê o mesmo Firestore do site, com o login de cada um (o token fica protegido pelo Windows/DPAPI).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Mural
{
    static class Config
    {
        public const string ApiKey = "AIzaSyDp0AOeioDvOPGxLW2f0xtXzgGp32Lorms";
        public const string Projeto = "mural-bjorn-yoshiro";
        public const string Site = "https://srbjorn.github.io/mural/";
        public static readonly string Pasta = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mural");
        public static readonly CultureInfo PtBr = new CultureInfo("pt-BR");
    }

    // ------------------------------------------------------------------ rede

    class ErroMural : Exception
    {
        public readonly bool PrecisaLogin;
        public ErroMural(string msg, bool precisaLogin) : base(msg) { PrecisaLogin = precisaLogin; }
    }

    static class Api
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        public static object Ler(string json) { return Json.DeserializeObject(json); }
        public static string Escrever(object o) { return Json.Serialize(o); }

        /// <summary>POST; devolve o corpo da resposta. Erro HTTP vira ErroHttp com o corpo do erro.</summary>
        public static string Post(string url, string corpo, string tipo, string token)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "POST";
                req.ContentType = tipo;
                req.Timeout = 20000;
                if (token != null) req.Headers["Authorization"] = "Bearer " + token;
                var bytes = Encoding.UTF8.GetBytes(corpo);
                using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                using (var r = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(r.GetResponseStream(), Encoding.UTF8))
                    return sr.ReadToEnd();
            }
            catch (WebException e)
            {
                var resp = e.Response as HttpWebResponse;
                if (resp == null) throw new ErroMural("Sem conexão com a internet.", false);
                string erro;
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) erro = sr.ReadToEnd();
                throw new ErroHttp((int)resp.StatusCode, erro);
            }
        }

        public static string CodigoDoErro(string corpo)
        {
            try
            {
                var d = (Dictionary<string, object>)Ler(corpo);
                var e = d["error"];
                var de = e as Dictionary<string, object>;
                if (de != null) return Convert.ToString(de["message"]);
                return Convert.ToString(e);
            }
            catch { return ""; }
        }
    }

    class ErroHttp : Exception
    {
        public readonly int Status;
        public readonly string Corpo;
        public ErroHttp(int status, string corpo) : base("HTTP " + status) { Status = status; Corpo = corpo; }
    }

    // ------------------------------------------------------------------ login

    class Sessao
    {
        public string Uid, Refresh, IdToken;
        public DateTime Expira;

        static string Arquivo { get { return Path.Combine(Config.Pasta, "sessao.bin"); } }

        public static Sessao Carregar()
        {
            try
            {
                var b = ProtectedData.Unprotect(File.ReadAllBytes(Arquivo), null, DataProtectionScope.CurrentUser);
                var p = Encoding.UTF8.GetString(b).Split('\n');
                return new Sessao { Uid = p[0], Refresh = p[1] };
            }
            catch { return null; }
        }

        void Salvar()
        {
            Directory.CreateDirectory(Config.Pasta);
            var b = ProtectedData.Protect(Encoding.UTF8.GetBytes(Uid + "\n" + Refresh), null, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(Arquivo, b);
        }

        public static void Apagar() { try { File.Delete(Arquivo); } catch { } }

        public static Sessao Entrar(string email, string senha)
        {
            var corpo = Api.Escrever(new Dictionary<string, object> {
                { "email", email }, { "password", senha }, { "returnSecureToken", true } });
            string resp;
            try
            {
                resp = Api.Post("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + Config.ApiKey,
                    corpo, "application/json", null);
            }
            catch (ErroHttp e)
            {
                var c = Api.CodigoDoErro(e.Corpo);
                if (c.StartsWith("TOO_MANY_ATTEMPTS")) throw new ErroMural("Muitas tentativas. Espere um pouco e tente de novo.", true);
                if (c == "INVALID_EMAIL") throw new ErroMural("Esse email não parece certo.", true);
                if (c == "USER_DISABLED") throw new ErroMural("Esta conta foi desativada.", true);
                throw new ErroMural("Email ou senha incorretos.", true);
            }
            var r = (Dictionary<string, object>)Api.Ler(resp);
            var s = new Sessao
            {
                Uid = (string)r["localId"],
                Refresh = (string)r["refreshToken"],
                IdToken = (string)r["idToken"],
                Expira = DateTime.UtcNow.AddSeconds(int.Parse(Convert.ToString(r["expiresIn"])) - 120)
            };
            s.Salvar();
            return s;
        }

        /// <summary>Token válido para o Firestore; renova sozinho quando vence.</summary>
        public string Token()
        {
            if (IdToken != null && DateTime.UtcNow < Expira) return IdToken;
            string resp;
            try
            {
                resp = Api.Post("https://securetoken.googleapis.com/v1/token?key=" + Config.ApiKey,
                    "grant_type=refresh_token&refresh_token=" + Uri.EscapeDataString(Refresh),
                    "application/x-www-form-urlencoded", null);
            }
            catch (ErroHttp)
            {
                throw new ErroMural("Entre de novo no mural.", true);
            }
            var r = (Dictionary<string, object>)Api.Ler(resp);
            IdToken = (string)r["id_token"];
            Refresh = (string)r["refresh_token"];
            Uid = (string)r["user_id"];
            Expira = DateTime.UtcNow.AddSeconds(int.Parse(Convert.ToString(r["expires_in"])) - 120);
            Salvar();
            return IdToken;
        }
    }

    // ------------------------------------------------------------------ dados

    class Item
    {
        public string Tipo, Titulo, Autor, Data, Hora, Niver;
        public int Ano;
    }

    class Compromisso
    {
        public string Quando, Titulo, Autor, Hora;
        public DateTime Dia;
        public bool Atrasado, Niver;
    }

    static class Dados
    {
        public static List<Item> Buscar(Sessao s)
        {
            var url = "https://firestore.googleapis.com/v1/projects/" + Config.Projeto + "/databases/(default)/documents:runQuery";
            const string consulta = "{\"structuredQuery\":{\"from\":[{\"collectionId\":\"itens\"}]," +
                "\"where\":{\"fieldFilter\":{\"field\":{\"fieldPath\":\"feito\"},\"op\":\"EQUAL\",\"value\":{\"booleanValue\":false}}}}}";
            string resp;
            try { resp = Api.Post(url, consulta, "application/json", s.Token()); }
            catch (ErroHttp e)
            {
                if (e.Status == 401) throw new ErroMural("Entre de novo no mural.", true);
                if (e.Status == 403) throw new ErroMural("Esta conta não tem acesso ao mural.", false);
                throw new ErroMural("O mural não respondeu agora.", false);
            }
            var lista = new List<Item>();
            var arr = Api.Ler(resp) as object[];
            if (arr == null) return lista;
            foreach (var o in arr)
            {
                var d = o as Dictionary<string, object>;
                if (d == null || !d.ContainsKey("document")) continue;
                var doc = (Dictionary<string, object>)d["document"];
                var f = doc.ContainsKey("fields") ? (Dictionary<string, object>)doc["fields"] : new Dictionary<string, object>();
                int ano;
                int.TryParse(Valor(f, "ano"), out ano);
                lista.Add(new Item
                {
                    Tipo = Valor(f, "tipo") ?? "nota",
                    Titulo = Valor(f, "titulo") ?? "",
                    Autor = Valor(f, "autor") ?? "",
                    Data = Valor(f, "data"),
                    Hora = Valor(f, "hora") ?? "",
                    Niver = Valor(f, "niver"),
                    Ano = ano
                });
            }
            return lista;
        }

        static string Valor(Dictionary<string, object> f, string chave)
        {
            object v, x;
            if (!f.TryGetValue(chave, out v)) return null;
            var d = v as Dictionary<string, object>;
            if (d == null) return null;
            if (d.TryGetValue("stringValue", out x)) return (string)x;
            if (d.TryGetValue("integerValue", out x)) return Convert.ToString(x, CultureInfo.InvariantCulture);
            if (d.TryGetValue("doubleValue", out x)) return Convert.ToString(Convert.ToInt64(x), CultureInfo.InvariantCulture);
            return null;
        }

        static DateTime DataNiver(int ano, int mes, int dia)
        {
            if (mes == 2 && dia == 29 && !DateTime.IsLeapYear(ano)) return new DateTime(ano, 2, 28);
            return new DateTime(ano, mes, dia);
        }

        /// <summary>Compromissos com data: atrasados, os próximos 14 dias e aniversários dos próximos 7.</summary>
        public static List<Compromisso> Proximos(List<Item> itens)
        {
            var hoje = DateTime.Today;
            var lista = new List<Compromisso>();
            foreach (var it in itens)
            {
                if (it.Tipo == "aniversario")
                {
                    int m, d;
                    if (it.Niver == null || it.Niver.Length != 5 ||
                        !int.TryParse(it.Niver.Substring(0, 2), out m) || !int.TryParse(it.Niver.Substring(3, 2), out d) ||
                        m < 1 || m > 12 || d < 1 || d > 31) continue;
                    DateTime prox;
                    try
                    {
                        prox = DataNiver(hoje.Year, m, d);
                        if (prox < hoje) prox = DataNiver(hoje.Year + 1, m, d);
                    }
                    catch { continue; }
                    var dias = (prox - hoje).Days;
                    if (dias > 7) continue;
                    lista.Add(new Compromisso
                    {
                        Dia = prox, Niver = true, Autor = it.Autor, Hora = "",
                        Titulo = "Aniversário de " + it.Titulo + (it.Ano > 1900 ? " (faz " + (prox.Year - it.Ano) + ")" : ""),
                        Quando = dias == 0 ? "Hoje!" : dias == 1 ? "Amanhã" : "Em " + dias + " dias"
                    });
                    continue;
                }
                DateTime dia;
                if (it.Data == null || !DateTime.TryParseExact(it.Data, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                        DateTimeStyles.None, out dia)) continue;
                if (dia > hoje.AddDays(14)) continue;
                var atrasado = dia < hoje;
                string quando;
                if (atrasado) quando = "Atrasado";
                else if (dia == hoje) quando = "Hoje";
                else if (dia == hoje.AddDays(1)) quando = "Amanhã";
                else quando = dia.ToString("ddd, d MMM", Config.PtBr).Replace(".", "");
                if (!atrasado && it.Hora != "") quando += " · " + it.Hora;
                lista.Add(new Compromisso { Dia = dia, Atrasado = atrasado, Autor = it.Autor, Hora = it.Hora, Titulo = it.Titulo, Quando = quando });
            }
            return lista
                .OrderBy(c => c.Atrasado ? 0 : 1)
                .ThenBy(c => c.Dia)
                .ThenBy(c => c.Hora == "" ? "99" : c.Hora)
                .Take(10)
                .ToList();
        }

        public static List<Compromisso> Exemplo()
        {
            var h = DateTime.Today;
            return new List<Compromisso> {
                new Compromisso { Dia = h, Autor = "yoshiro", Titulo = "Consulta no dentista", Quando = "Hoje · 15:30", Hora = "15:30" },
                new Compromisso { Dia = h, Autor = "bjorn", Niver = true, Titulo = "Aniversário de Lucas (faz 30)", Quando = "Hoje!", Hora = "" },
                new Compromisso { Dia = h.AddDays(1), Autor = "bjorn", Titulo = "Mercado da semana", Quando = "Amanhã", Hora = "" },
                new Compromisso { Dia = h.AddDays(-1), Autor = "yoshiro", Atrasado = true, Titulo = "Pagar a conta de luz", Quando = "Atrasado", Hora = "" },
            };
        }
    }

    // ------------------------------------------------------------------ Windows

    static class Win
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string nome);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr pai, IntPtr depois, string cls, string nome);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr filho, IntPtr pai);
        [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int a, bool redesenhar);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
        [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr depois, int x, int y, int w, int a, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
        public delegate bool EnumProc(IntPtr h, IntPtr p);
        [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr pai, EnumProc proc, IntPtr p);
        public const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;

        /// <summary>Classes das janelas filhas diretas (para o registro de diagnóstico).</summary>
        public static string Filhas(IntPtr pai)
        {
            var nomes = new List<string>();
            EnumChildWindows(pai, (h, p) =>
            {
                if (GetParent(h) == pai)
                {
                    var sb = new StringBuilder(256);
                    GetClassName(h, sb, 256);
                    RECT r;
                    GetWindowRect(h, out r);
                    nomes.Add(sb + " [" + r.Left + "," + r.Top + " " + (r.Right - r.Left) + "x" + (r.Bottom - r.Top) + "]");
                }
                return true;
            }, IntPtr.Zero);
            return string.Join("; ", nomes);
        }
        public const int GWL_STYLE = -16;
        public const int WS_CHILD = 0x40000000;
        public const int WS_POPUP = unchecked((int)0x80000000);
        public const int WS_CLIPSIBLINGS = 0x04000000;
    }

    // ------------------------------------------------------------------ registro de diagnóstico

    /// <summary>%LOCALAPPDATA%\Mural\barra.log: versão do Windows, como a barra foi encaixada e erros. Nunca grava senha nem token.</summary>
    static class Registro
    {
        static readonly string Arquivo = Path.Combine(Config.Pasta, "barra.log");
        static string ultimoModo;
        public static readonly int Build = LerBuild();
        public static bool ForcarWin11; // "--win11": testa o encaixe do Windows 11 num Windows 10
        public static bool Windows11 { get { return ForcarWin11 || Build >= 22000; } }

        static int LerBuild()
        {
            try { return int.Parse(Convert.ToString(Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber", "0"))); }
            catch { return 0; }
        }

        public static void Escrever(string linha)
        {
            try
            {
                Directory.CreateDirectory(Config.Pasta);
                var info = new FileInfo(Arquivo);
                if (info.Exists && info.Length > 200000) info.Delete();
                File.AppendAllText(Arquivo, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + linha + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }

        /// <summary>Anota o jeito de encaixar só quando muda (o encaixe roda a cada 1,5 s).</summary>
        public static void Modo(string modo)
        {
            if (modo == ultimoModo) return;
            ultimoModo = modo;
            Escrever("modo: " + modo);
        }

        public static void Inicio(float escala)
        {
            Escrever("----- MuralBarra aberto. Windows build " + Build + (Windows11 ? " (Windows 11)" : " (Windows 10)") +
                     ", escala " + escala.ToString("0.00", CultureInfo.InvariantCulture));
            var bandeja = Win.FindWindow("Shell_TrayWnd", null);
            Win.RECT r;
            if (bandeja != IntPtr.Zero && Win.GetWindowRect(bandeja, out r))
            {
                Escrever("barra de tarefas: [" + r.Left + "," + r.Top + " " + (r.Right - r.Left) + "x" + (r.Bottom - r.Top) + "]");
                Escrever("partes da barra: " + Win.Filhas(bandeja));
            }
            else Escrever("barra de tarefas (Shell_TrayWnd) não encontrada");
        }

        public static void Abrir()
        {
            try { Process.Start("notepad.exe", "\"" + Arquivo + "\""); } catch { }
        }
    }

    // ------------------------------------------------------------------ janela de login

    class FormLogin : Form
    {
        public Sessao Resultado;
        readonly TextBox email = new TextBox(), senha = new TextBox();
        readonly Label erro = new Label();
        readonly Button entrar = new Button();

        public FormLogin()
        {
            Text = "Mural na barra de tarefas";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 10f);
            BackColor = Color.FromArgb(28, 31, 30);
            ForeColor = Color.FromArgb(238, 241, 239);
            ClientSize = new Size(380, 300);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            var titulo = new Label { Text = "Entre com a sua conta do mural", Font = new Font("Segoe UI Semibold", 13f), AutoSize = true, Location = new Point(24, 20) };
            var sub = new Label { Text = "O mesmo email e senha do site. Só precisa fazer isso uma vez.", AutoSize = false, Size = new Size(332, 40), Location = new Point(24, 52), ForeColor = Color.FromArgb(169, 178, 173) };
            var le = new Label { Text = "Email", AutoSize = true, Location = new Point(24, 98) };
            email.SetBounds(24, 120, 332, 28);
            var ls = new Label { Text = "Senha", AutoSize = true, Location = new Point(24, 156) };
            senha.SetBounds(24, 178, 332, 28);
            senha.UseSystemPasswordChar = true;
            erro.SetBounds(24, 212, 332, 22);
            erro.ForeColor = Color.FromArgb(255, 107, 111);
            entrar.Text = "Entrar";
            entrar.SetBounds(236, 244, 120, 36);
            entrar.FlatStyle = FlatStyle.Flat;
            entrar.BackColor = Color.FromArgb(164, 0, 255);
            entrar.ForeColor = Color.White;
            entrar.FlatAppearance.BorderSize = 0;
            entrar.Click += Entrar;
            AcceptButton = entrar;
            Controls.AddRange(new Control[] { titulo, sub, le, email, ls, senha, erro, entrar });
        }

        async void Entrar(object sender, EventArgs e)
        {
            var em = email.Text.Trim();
            var se = senha.Text;
            if (em == "" || se == "") { erro.Text = "Preencha email e senha."; return; }
            entrar.Enabled = false;
            erro.Text = "Entrando…";
            try
            {
                Resultado = await Task.Run(() => Sessao.Entrar(em, se));
                DialogResult = DialogResult.OK;
                Close();
            }
            catch (ErroMural ex) { erro.Text = ex.Message; }
            catch (Exception) { erro.Text = "Não deu certo. Tente de novo."; }
            entrar.Enabled = true;
        }
    }

    // ------------------------------------------------------------------ a barra

    class Barra : Form
    {
        static readonly Color Roxo = Color.FromArgb(164, 0, 255), RoxoClaro = Color.FromArgb(201, 139, 255);
        static readonly Color Verde = Color.FromArgb(70, 201, 143), VerdeClaro = Color.FromArgb(99, 227, 169);
        static readonly Color Vermelho = Color.FromArgb(255, 107, 111), Festa = Color.FromArgb(255, 122, 168);

        Sessao sessao;
        readonly bool demo, claro;
        List<Compromisso> lista = new List<Compromisso>();
        string aviso = "Carregando o mural…";
        int atual;
        float anim = 1f; // 0 → 1 ao trocar de item
        readonly Image rostoB, rostoY;
        readonly System.Windows.Forms.Timer tGirar = new System.Windows.Forms.Timer { Interval = 6000 };
        readonly System.Windows.Forms.Timer tAnim = new System.Windows.Forms.Timer { Interval = 15 };
        readonly System.Windows.Forms.Timer tEncaixe = new System.Windows.Forms.Timer { Interval = 1500 };
        readonly System.Windows.Forms.Timer tDados = new System.Windows.Forms.Timer { Interval = 120000 };
        readonly ToolTip dica = new ToolTip { InitialDelay = 400, ReshowDelay = 200, AutoPopDelay = 20000 };
        IntPtr bandeja, lista_janelas, rebar;
        bool embutido, buscando, pausado;
        float esc = 1f;
        DateTime diaVisto = DateTime.Today;

        public Barra(Sessao s, bool demo)
        {
            sessao = s;
            this.demo = demo;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            DoubleBuffered = true;
            Text = "Mural";
            try { claro = Convert.ToInt32(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "SystemUsesLightTheme", 0)) == 1; } catch { }
            BackColor = claro ? Color.FromArgb(243, 243, 243) : Color.FromArgb(38, 41, 40);
            rostoB = Recurso("rosto_bjorn.png");
            rostoY = Recurso("rosto_yoshiro.png");

            var menu = new ContextMenuStrip();
            menu.Items.Add("Abrir o mural", null, (a, b) => AbrirMural());
            menu.Items.Add("Próximo compromisso", null, (a, b) => Girar(1));
            menu.Items.Add("Atualizar agora", null, (a, b) => Atualizar());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sair da conta", null, (a, b) => SairDaConta());
            menu.Items.Add("Abrir o registro (diagnóstico)", null, (a, b) => Registro.Abrir());
            menu.Items.Add("Fechar a barra", null, (a, b) => Close());
            ContextMenuStrip = menu;

            tGirar.Tick += (a, b) => { if (!pausado) Girar(1); };
            tAnim.Tick += (a, b) => { anim = Math.Min(1f, anim + 0.08f); if (anim >= 1f) tAnim.Stop(); Invalidate(); };
            tEncaixe.Tick += (a, b) => { Encaixar(); if (DateTime.Today != diaVisto) { diaVisto = DateTime.Today; Atualizar(); } };
            tDados.Tick += (a, b) => Atualizar();
            MouseEnter += (a, b) => pausado = true;
            MouseLeave += (a, b) => pausado = false;
            MouseClick += (a, b) => { if (b.Button == MouseButtons.Left) AbrirMural(); };
            MouseWheel += (a, b) => Girar(b.Delta < 0 ? 1 : -1);
            Cursor = Cursors.Hand;
        }

        static Image Recurso(string nome)
        {
            try { return Image.FromStream(Assembly.GetExecutingAssembly().GetManifestResourceStream("Mural." + nome)); }
            catch { return null; }
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            using (var g = CreateGraphics()) esc = g.DpiX / 96f;
            Registro.Inicio(esc);
            Encaixar();
            var pedido = new EventWaitHandle(false, EventResetMode.AutoReset, "MuralBarraBjornYoshiroFechar");
            ThreadPool.RegisterWaitForSingleObject(pedido, (st, t) => { try { BeginInvoke((Action)Close); } catch { } }, null, -1, true);
            tGirar.Start();
            tEncaixe.Start();
            tDados.Start();
            Atualizar();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            // Devolve o espaço da lista de janelas.
            if (embutido && Win.IsWindow(lista_janelas) && Win.IsWindow(rebar))
            {
                Win.RECT rr, kr;
                Win.GetWindowRect(rebar, out rr);
                Win.GetWindowRect(lista_janelas, out kr);
                Win.MoveWindow(lista_janelas, kr.Left - rr.Left, kr.Top - rr.Top, rr.Right - kr.Left, kr.Bottom - kr.Top, true);
            }
            base.OnFormClosed(e);
        }

        // ---------- posição: dentro da barra de tarefas, ao lado do relógio

        void Encaixar()
        {
            if (embutido && !Win.IsWindow(bandeja))
            {
                // O Explorer reiniciou: abre de novo para se encaixar na barra nova.
                try { Process.Start(Application.ExecutablePath, demo ? "--demo" : ""); } catch { }
                Application.Exit();
                return;
            }
            bandeja = Win.FindWindow("Shell_TrayWnd", null);
            Win.RECT tr;
            if (bandeja == IntPtr.Zero || !Win.GetWindowRect(bandeja, out tr) || (tr.Right - tr.Left) < (tr.Bottom - tr.Top))
            {
                Registro.Modo("flutuando (barra de tarefas não encontrada ou na vertical)");
                Flutuar();
                return;
            }
            rebar = Win.FindWindowEx(bandeja, IntPtr.Zero, "ReBarWindow32", null);
            lista_janelas = rebar == IntPtr.Zero ? IntPtr.Zero : Win.FindWindowEx(rebar, IntPtr.Zero, "MSTaskSwWClass", null);
            var alturaBarra = tr.Bottom - tr.Top;
            var largura = (int)(300 * esc);
            var altura = Math.Max((int)(32 * esc), alturaBarra - (int)(8 * esc));
            var y = (alturaBarra - altura) / 2;
            if (!embutido)
            {
                TopMost = false;
                var estilo = Win.GetWindowLong(Handle, Win.GWL_STYLE);
                Win.SetWindowLong(Handle, Win.GWL_STYLE, (estilo & ~Win.WS_POPUP) | Win.WS_CHILD | Win.WS_CLIPSIBLINGS);
                Win.SetParent(Handle, bandeja);
                embutido = true;
            }

            if (Registro.Windows11 || lista_janelas == IntPtr.Zero)
            {
                // Windows 11: a barra é desenhada de outro jeito e não dá para encolher a lista de janelas.
                // Os ícones ficam no centro, então a barrinha entra no espaço vazio à esquerda do relógio.
                var area = Win.FindWindowEx(bandeja, IntPtr.Zero, "TrayNotifyWnd", null);
                Win.RECT nr;
                int fim;
                if (area != IntPtr.Zero && Win.GetWindowRect(area, out nr) && nr.Right - nr.Left > 0 && nr.Left > tr.Left)
                    fim = nr.Left - tr.Left;
                else
                    fim = (tr.Right - tr.Left) - (int)(380 * esc); // estimativa: relógio + ícones de sistema
                var x11 = fim - largura - (int)(8 * esc);
                Registro.Modo("Windows 11, à esquerda do relógio em x=" + x11 + (area == IntPtr.Zero ? " (área do relógio estimada)" : ""));
                Posicionar(x11, y, largura, altura);
                Win.SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, Win.SWP_NOMOVE | Win.SWP_NOSIZE | Win.SWP_NOACTIVATE | Win.SWP_SHOWWINDOW);
                return;
            }

            Registro.Modo("Windows 10, dentro da barra de tarefas");
            Win.RECT rr, kr;
            Win.GetWindowRect(rebar, out rr);
            Win.GetWindowRect(lista_janelas, out kr);
            var margem = (int)(6 * esc);
            var fimLista = (rr.Right - rr.Left) - largura - margem; // em coordenadas do rebar
            var inicioLista = kr.Left - rr.Left;
            if (kr.Right - rr.Left > fimLista && fimLista > inicioLista)
                Win.MoveWindow(lista_janelas, inicioLista, kr.Top - rr.Top, fimLista - inicioLista, kr.Bottom - kr.Top, true);
            Posicionar((rr.Left - tr.Left) + (rr.Right - rr.Left) - largura, y, largura, altura);
        }

        Rectangle posicaoAtual;

        void Posicionar(int x, int y, int largura, int altura)
        {
            // Compara com a última posição aplicada: Left/Top do Form não acompanham uma janela filha da barra.
            var nova = new Rectangle(x, y, largura, altura);
            if (nova == posicaoAtual) return;
            posicaoAtual = nova;
            Win.MoveWindow(Handle, x, y, largura, altura, true);
            Arredondar();
            Registro.Escrever("posição na barra: x=" + x + " y=" + y + " " + largura + "x" + altura);
        }

        void Flutuar()
        {
            // Barra na vertical ou não encontrada: fica flutuando no canto, acima de tudo.
            if (embutido) return;
            TopMost = true;
            var area = Screen.PrimaryScreen.WorkingArea;
            var largura = (int)(300 * esc);
            var altura = (int)(40 * esc);
            Bounds = new Rectangle(area.Right - largura - (int)(12 * esc), area.Bottom - altura - (int)(12 * esc), largura, altura);
            Arredondar();
        }

        void Arredondar()
        {
            var r = (int)(8 * esc);
            using (var p = Caminho(new Rectangle(0, 0, Width, Height), r)) Region = new Region(p);
        }

        static GraphicsPath Caminho(Rectangle a, int r)
        {
            var p = new GraphicsPath();
            var d = r * 2;
            p.AddArc(a.Left, a.Top, d, d, 180, 90);
            p.AddArc(a.Right - d, a.Top, d, d, 270, 90);
            p.AddArc(a.Right - d, a.Bottom - d, d, d, 0, 90);
            p.AddArc(a.Left, a.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        // ---------- dados

        async void Atualizar()
        {
            if (buscando) return;
            buscando = true;
            try
            {
                if (demo) { await Task.Delay(300); lista = Dados.Exemplo(); aviso = null; }
                else
                {
                    var s = sessao;
                    var novos = await Task.Run(() => Dados.Proximos(Dados.Buscar(s)));
                    lista = novos;
                    aviso = novos.Count == 0 ? "Nada marcado nos próximos dias" : null;
                }
                if (atual >= lista.Count) atual = 0;
            }
            catch (ErroMural e)
            {
                aviso = e.Message;
                Registro.Escrever("ao buscar o mural: " + e.Message);
                if (e.PrecisaLogin) { buscando = false; PedirLogin(); return; }
            }
            catch (Exception ex)
            {
                aviso = "O mural não respondeu agora.";
                Registro.Escrever("erro inesperado ao buscar: " + ex.GetType().Name + ": " + ex.Message);
            }
            buscando = false;
            AtualizarDica();
            anim = 0f;
            tAnim.Start();
            Invalidate();
        }

        void PedirLogin()
        {
            Sessao.Apagar();
            using (var f = new FormLogin())
            {
                if (f.ShowDialog() == DialogResult.OK) { sessao = f.Resultado; Atualizar(); }
                else Close();
            }
        }

        void SairDaConta()
        {
            Sessao.Apagar();
            sessao = null;
            lista = new List<Compromisso>();
            aviso = "Saiu da conta";
            Invalidate();
            PedirLogin();
        }

        void AtualizarDica()
        {
            var sb = new StringBuilder();
            if (lista.Count == 0) sb.Append(aviso ?? "Nada marcado nos próximos dias");
            foreach (var c in lista) sb.AppendLine(c.Quando + "  —  " + c.Titulo);
            sb.AppendLine();
            sb.Append("Clique para abrir o mural · rodinha do mouse para passar");
            dica.SetToolTip(this, sb.ToString().Trim());
        }

        void Girar(int passo)
        {
            if (lista.Count < 2) return;
            atual = (atual + passo + lista.Count) % lista.Count;
            anim = 0f;
            tAnim.Start();
        }

        void AbrirMural()
        {
            var atalho = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Mural.lnk");
            try { Process.Start(File.Exists(atalho) ? atalho : Config.Site); } catch { }
        }

        // ---------- desenho

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            var texto = claro ? Color.FromArgb(30, 33, 32) : Color.FromArgb(241, 243, 242);
            var apagado = claro ? Color.FromArgb(90, 98, 94) : Color.FromArgb(169, 178, 173);
            g.Clear(BackColor);

            var pad = (int)(5 * esc);
            var face = Height - pad * 2;
            Compromisso c = lista.Count > 0 ? lista[Math.Min(atual, lista.Count - 1)] : null;
            var dy = (int)((1f - Suave(anim)) * Height * 0.45f);
            var alfa = (int)(255 * Suave(anim));

            // Rosto de quem anotou, com anel na cor da pessoa
            var corPessoa = c == null ? apagado : c.Autor == "yoshiro" ? Verde : Roxo;
            var rosto = c == null ? null : c.Autor == "yoshiro" ? rostoY : rostoB;
            var rf = new Rectangle(pad, pad, face, face);
            if (rosto != null)
            {
                using (var clip = new GraphicsPath())
                {
                    clip.AddEllipse(rf);
                    var antes = g.Clip;
                    g.SetClip(clip);
                    g.DrawImage(rosto, rf);
                    g.Clip = antes;
                }
            }
            else
            {
                using (var b = new SolidBrush(Color.FromArgb(alfa, corPessoa))) g.FillEllipse(b, rf);
            }
            using (var p = new Pen(corPessoa, Math.Max(2f, 2f * esc))) g.DrawEllipse(p, rf);

            // Contador "2/5"
            var xTexto = pad * 2 + face;
            var direita = Width - pad * 2;
            using (var fc = new Font("Segoe UI", 7.5f))
            {
                if (lista.Count > 1)
                {
                    var s = (atual + 1) + "/" + lista.Count;
                    var t = g.MeasureString(s, fc);
                    using (var b = new SolidBrush(apagado))
                        g.DrawString(s, fc, b, direita - t.Width, (Height - t.Height) / 2);
                    direita -= (int)t.Width + pad;
                }
            }

            // Duas linhas: quando (colorido) e o título
            var linha1 = c == null ? "Mural" : c.Quando;
            var linha2 = c == null ? aviso ?? "" : c.Titulo;
            var cor1 = c == null ? apagado : c.Niver ? Festa : c.Atrasado ? Vermelho : (c.Autor == "yoshiro" ? VerdeClaro : RoxoClaro);
            if (claro && c != null && !c.Niver && !c.Atrasado) cor1 = c.Autor == "yoshiro" ? Color.FromArgb(23, 115, 75) : Color.FromArgb(116, 16, 196);
            var area = new RectangleF(xTexto, 0, Math.Max(10, direita - xTexto), Height);
            using (var f1 = new Font("Segoe UI Semibold", 7.5f))
            using (var f2 = new Font("Segoe UI", 9f))
            using (var b1 = new SolidBrush(Color.FromArgb(alfa, cor1)))
            using (var b2 = new SolidBrush(Color.FromArgb(alfa, texto)))
            using (var fmt = new StringFormat(StringFormatFlags.NoWrap) { Trimming = StringTrimming.EllipsisCharacter })
            {
                var h1 = f1.GetHeight(g);
                var h2 = f2.GetHeight(g);
                var topo = (Height - h1 - h2) / 2 + dy;
                g.DrawString(linha1.ToUpper(Config.PtBr), f1, b1, new RectangleF(area.X, topo, area.Width, h1 + 2), fmt);
                g.DrawString(linha2, f2, b2, new RectangleF(area.X, topo + h1 - 1, area.Width, h2 + 2), fmt);
            }
        }

        static float Suave(float t) { return 1f - (1f - t) * (1f - t) * (1f - t); }
    }

    static class Programa
    {
        [STAThread]
        static void Main(string[] args)
        {
            // "MuralBarra.exe --fechar" pede para a barra que está aberta se fechar (usado pelo desinstalador).
            bool criado;
            using (var fechar = new EventWaitHandle(false, EventResetMode.AutoReset, "MuralBarraBjornYoshiroFechar", out criado))
            {
                if (args.Contains("--fechar")) { fechar.Set(); return; }
            }
            bool novo;
            using (var trava = new Mutex(true, "MuralBarraBjornYoshiro", out novo))
            {
                if (!novo) return;
                Win.SetProcessDPIAware();
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                var demo = args.Contains("--demo");
                Registro.ForcarWin11 = args.Contains("--win11");
                Sessao s = demo ? null : Sessao.Carregar();
                if (!demo && s == null)
                {
                    using (var f = new FormLogin())
                    {
                        if (f.ShowDialog() != DialogResult.OK) return;
                        s = f.Resultado;
                    }
                }
                Application.Run(new Barra(s, demo));
            }
        }
    }
}
