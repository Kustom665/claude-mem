# digital

Standalone web projects that are not part of claude-mem. They live here only
so the work survives the session container — each is meant to become its own
repository.

| Project | What it is | Status |
| --- | --- | --- |
| `ghosting-garden/` | 名残 — a digital zen sand garden. Rake real furrows that part around the stones, then watch them ghost away. | Wants its own repo |

## Moving `ghosting-garden` into its own repository

The folder is already a complete, self-contained project with its own README
and build script. To split it out with its history intact:

```bash
# create an empty repo named ghosting-garden on GitHub first, then:
cd digital/ghosting-garden
git init -b main
git add -A
git commit -m "Ghosting Garden V1 — a digital zen sand garden"
git remote add origin git@github.com:<you>/ghosting-garden.git
git push -u origin main
```

Then delete `digital/ghosting-garden/` from this repo.

To serve it on GitHub Pages, point Pages at the repository root and rename
`index.html` — it is already the standalone build and needs no server.
