# Publicação

Já publicado: <https://github.com/emersoncassis/valheim-server> (privado),
branch `master`.

Deploy: veja a seção **Deploy no Dokploy** no [README.md](README.md).

## Se precisar publicar de novo (ex: outra máquina, outro repo)

```powershell
cd C:\Users\emers\Desktop\REPO\valheim
git remote set-url origin https://github.com/<usuario>/<repo>.git
git push -u origin master
```

Antes de publicar em qualquer lugar novo, confirme que `.env` não está
rastreado:

```powershell
git ls-files | Select-String "\.env$"
```

Vazio = seguro. Qualquer linha aparecendo = pare e resolva antes do push.
