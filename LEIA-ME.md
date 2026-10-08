# Mural Bjørn & Yoshiro

Anotações, checklists, eventos, metas e calendário compartilhados entre vocês dois.
O que um anota aparece para o outro na hora.

| Parte | Onde fica | O que faz |
|---|---|---|
| `web/` | GitHub Pages | O mural em si (PC, celular, navegador) |
| `android/` | APK nas Releases do GitHub | App + widget na tela inicial + notificações |
| `pc/` | Cada PC | Abre o mural com o aviso do dia quando o Windows liga |
| `firestore.rules` | Firebase | Quem pode ler e escrever |

## 1. Firebase (uma vez, no navegador)

1. Em <https://console.firebase.google.com>, crie o projeto **mural-bjorn-yoshiro** (pode desligar o Google Analytics).
2. **Authentication → Começar → E-mail/senha → Ativar**.
3. **Firestore Database → Criar banco de dados →** modo de produção, região `southamerica-east1 (São Paulo)`.
4. Em **Firestore → Regras**, cole o conteúdo de `firestore.rules` e clique em **Publicar**.
5. **Configurações do projeto → Seus apps → Web (`</>`)**, com o apelido `mural-web`. Copie o `firebaseConfig` para `web/firebase-config.js`.
6. Ainda em **Seus apps → Android**, use o pacote `com.bjornyoshiro.mural`. Baixe o `google-services.json` e salve em `android/app/`.
7. Cada um abre o mural e cria a sua conta. Depois disso, desligue novas contas em
   **Authentication → Configurações → Ações do usuário → desmarcar "Ativar criação (inscrição)"**.

## 2. GitHub

O repositório `mural` publica o site e gera o APK sozinho a cada envio, pelo workflow `.github/workflows/mural.yml`.
- Site: `https://<usuario>.github.io/mural/`
- APK: `https://github.com/<usuario>/mural/releases/latest/download/mural.apk`

Para o APK atualizar por cima da versão anterior, ele precisa sempre da mesma chave, que fica nos segredos do repositório:
`MURAL_KEYSTORE_B64` (a chave `.p12` em base64) e `MURAL_KEYSTORE_SENHA`.

## 3. Celulares

Baixe o `mural.apk` pelo link acima e instale (o Android pede para permitir apps desta fonte). Abra, entre e aceite as notificações.
Para pôr o widget, segure a tela inicial → **Widgets → Mural**.

- O widget atualiza a cada 15 minutos e sempre que você mexe no app.
- O celular notifica quando o outro anota algo, ao ligar o aparelho e todo dia às 8h com o resumo do dia.

## 4. PCs

Copie a pasta `pc/` e dê dois cliques em `INSTALAR.bat`. O mural passa a abrir com o aviso do dia sempre que o Windows iniciar.
Quando vocês fecham o aviso, o mural continua aberto. Também ficam atalhos na Área de Trabalho e no menu Iniciar.
Para desinstalar, rode `powershell -ExecutionPolicy Bypass -File instalar.ps1 -Remover`.

## Testar o visual sem Firebase

```bash
node tools/servir.mjs
```
Depois abra <http://localhost:5173/?demo>.

## Depois: bot do Telegram

O bot vai ler e escrever na mesma coleção `itens` do Firestore (com `firebase-admin`), usando os mesmos campos:
`tipo` (nota | checklist | evento | meta), `titulo`, `texto`, `prioridade` (1 a 3), `data` (AAAA-MM-DD), `hora`,
`checklist` [{t, ok}], `progresso`, `feito`, `autor` (bjorn | yoshiro), `criadoEm`.
