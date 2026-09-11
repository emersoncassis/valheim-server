# Publicar no GitHub

**Atenção:** o `git init` e o commit inicial **não** foram feitos — o ambiente
desta sessão ficou sem shell, então não consegui rodar git nenhum. Os arquivos
estão todos prontos na pasta; falta só versionar. São dois cliques a mais.

O `.gitignore` já está no lugar, com `.env` dentro dele. Você não vai commitar
senha por acidente.

---

## Opção A — GitHub Desktop (tudo pela interface)

1. **File** → **Add local repository**
2. Escolha `C:\Users\emers\Desktop\REPO\valheim`
3. Ele avisa que não é um repositório git e oferece **create a repository** —
   clique nisso
4. Na tela que abrir, deixe o nome como `valheim` e clique em
   **Create repository**
5. Ele mostra os arquivos a commitar. **Confira que `.env` NÃO está na lista**
   (não deve estar — ele nem existe ainda, você cria a partir do `.env.example`)
6. Mensagem do commit:

   ```
   Servidor Valheim dedicado com painel web de gerenciamento

   Docker Compose com volume persistente, backup automático com rotação
   e painel em Node sem dependências (auth por sessão HMAC, controle de
   ligar/parar, download e restauração de backups, leitura de log).
   Testes cobrindo rotação, autenticação e parsing de log.
   ```

7. **Commit to main**
8. **Publish repository** (botão no topo)
9. Nome: `valheim-server` · ✅ **Keep this code private**
10. **Publish repository**

---

## Opção B — Git Bash (mais rápido se você já usa)

```bash
cd /c/Users/emers/Desktop/REPO/valheim

git init -b main
git add .
git status          # confira: .env NÃO pode aparecer aqui

git commit -m "Servidor Valheim dedicado com painel web de gerenciamento" \
           -m "Docker Compose com volume persistente, backup automático com rotação e painel em Node sem dependências (auth por sessão HMAC, controle de ligar/parar, download e restauração de backups, leitura de log). Testes cobrindo rotação, autenticação e parsing de log."

gh repo create valheim-server --private --source=. --push
```

Sem o `gh` instalado, crie o repositório vazio no site e depois:

```bash
git remote add origin https://github.com/<seu-usuario>/valheim-server.git
git push -u origin main
```

---

## Antes de publicar, o check que importa

Rode `git status` (ou olhe a lista no GitHub Desktop) e confirme que
**`.env` não aparece**. Só o `.env.example` vai pro repositório.

Se o `.env` aparecer, pare — significa que o `.gitignore` não pegou.
Me avise antes de subir.
