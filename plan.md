core features

- button for link
- button for export
- button create template
- export on save option
- task to insert token

core plus

- safe export
    - pull the template before pushing and give warning if content from cloud has been updated
- open template from url to file (links etc)
- open template from extension payload via uri
    - potentially open template from server push

nice to have features

- re link options
- re link after renames
    - auto match based on hash
    - auto match based on content
    - auto match based on fielsystem unique id's
    - watch vscode renames and change internal structure if needed

extension core

- take in cookie from vscode uri

extension nice to have

- build in server to constantly listen
- extension pushes all rewst cookies to vscode extension

nice eventuallies:

- pull all templates to folder and link
    - (this would be after renames/ movements are handled, so you could organize as wanted after they exist)
    - perhaps set "sync" on folder, if any new templates in rewst exist it'll create/link them in vscode
