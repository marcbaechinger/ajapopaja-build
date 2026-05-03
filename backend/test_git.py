from pathlib import Path

import git

repo = git.Repo(Path("/home/marc-baechinger/monolit/code/ajapopaja-build"))
print("Active branch:", repo.active_branch.name)
