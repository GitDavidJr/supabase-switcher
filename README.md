# Supabase Account Switcher — Chrome Extension

> Troque entre múltiplas contas do Supabase com um clique. Sem logout, sem login repetido.

## Como funciona

O Supabase armazena tokens de sessão no `localStorage` do browser. Esta extensão salva e troca esses tokens, permitindo alternar entre contas instantaneamente.

**Tudo fica no seu computador** — nenhum dado é enviado para servidores externos.

---

## Instalação

### 1. Gerar os ícones

```bash
npm install canvas
node generate-icons.js
```

> Se não quiser instalar `canvas`, crie a pasta `icons/` manualmente e adicione qualquer PNG nos tamanhos 16x16, 48x48 e 128x128 com os nomes `icon16.png`, `icon48.png`, `icon128.png`.

### 2. Carregar no Chrome

1. Abra `chrome://extensions`
2. Ative **"Modo do desenvolvedor"** (canto superior direito)
3. Clique em **"Carregar sem compactação"**
4. Selecione esta pasta (`switch-supabase/`)

---

## Como usar

### Salvando uma conta
1. Abra o [dashboard do Supabase](https://supabase.com/dashboard) e faça login normalmente
2. Clique no ícone da extensão na barra do Chrome
3. Clique no botão **+** (canto superior direito do popup)
4. Dê um nome para a conta (ex: "Cliente A") e escolha uma cor
5. Clique em **Salvar conta**

Repita para cada uma das suas contas.

### Trocando de conta
1. Clique no ícone da extensão
2. Clique no nome da conta que deseja usar
3. O Supabase recarregará já logado nessa conta ✓

---

## Estrutura de arquivos

```
switch-supabase/
├── manifest.json        # Configuração da extensão (MV3)
├── background.js        # Service worker — lógica de sessão
├── content.js           # Content script (injetado no Supabase)
├── popup.html           # Interface do popup
├── popup.css            # Estilos dark mode premium
├── popup.js             # Lógica do popup
├── generate-icons.js    # Script para gerar os ícones PNG
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Limites & notas

- Funciona **apenas no `supabase.com`** (dashboard oficial)
- Não funciona em instâncias self-hosted do Supabase por padrão (pode ajustar `host_permissions` no `manifest.json`)
- Os tokens são armazenados no `chrome.storage.local` — limpos se você desinstalar a extensão
- Tokens de acesso expiram (normalmente em 1h). A extensão também salva o refresh token, então o Supabase irá renovar automaticamente após a troca
