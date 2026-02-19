# 🚀 Supabase Account Switcher

Troque entre múltiplas contas do Supabase com um único clique. Pare de deslogar e logar toda hora; gerencie todos os seus clientes em um só lugar.

---

## 🛠️ Guia de Instalação no Chrome

Siga estes passos simples para adicionar a extensão ao seu navegador:

### 1. Baixe o Código
Certifique-se de ter todos os arquivos do repositório em uma pasta no seu computador.

### 2. Ative o Modo do Desenvolvedor
1. Abra o Google Chrome.
2. Digite `chrome://extensions` na barra de endereços e aperte Enter.
3. No canto superior direito, ative a chave **"Modo do desenvolvedor"**.

### 3. Carregue a Extensão
1. Clique no botão **"Carregar sem compactação"** que apareceu no canto superior esquerdo.
2. Selecione a pasta onde você salvou os arquivos desta extensão.
3. A extensão "Supabase Account Switcher" aparecerá na sua lista!

---

## 📖 Como Usar (Passo a Passo)

### Passo 1: Salvar sua primeira conta
1. Vá para o [Dashboard do Supabase](https://supabase.com/dashboard) e faça login normalmente.
2. Clique no ícone de "quebra-cabeça" do Chrome (extensões) e clique no **Supabase Account Switcher** (Dica: Use o ícone de "fixar" para deixá-lo sempre visível).
3. No popup, clique no botão **+** (canto superior direito).
4. Dê um nome (ex: "Cliente Alfa") e escolha uma cor.
5. Clique em **Salvar conta**.

### Passo 2: Adicionar outras contas
1. Faça logout no site do Supabase.
2. Faça login com a conta do seu outro cliente.
3. Repita o processo de clicar no **+** e salvar com um novo nome (ex: "Projeto Beta").

### Passo 3: Trocar instantaneamente
1. Quando quiser trocar, basta abrir a extensão e clicar no nome da conta desejada.
2. A página irá recarregar automaticamente já logada na conta selecionada! ⚡

---

## 🛡️ Segurança e Privacidade
- **Local Only:** Todos os seus tokens de sessão são armazenados apenas no seu navegador (`chrome.storage.local`).
- **Sem Servidores Extras:** Nenhum dado é enviado para fora do seu computador.
- **Transparência:** O código é aberto e você pode verificar como os tokens são manipulados no arquivo `background.js`.

---

## 📝 Notas de Versão
- **Redirect Inteligente:** Ao trocar de conta, você é redirecionado para `/dashboard/organizations` para evitar erros de autenticação de workspace.
- **Multi-Projeto:** Suporta múltiplos projetos ativos na mesma sessão.

---

*Desenvolvido para facilitar a vida de quem gerencia múltiplos clientes no ecossistema Supabase.*
