# The Tüüler - A Karaoke Video Maker Thing

Making a decent karaoke video can take a long time.  
You need to separate the music from the vocals, and painstakingly adjust the timing of every syllable.  
This projects lets you create videos that are 80% perfect in 20% of the time.

This is a fork of https://github.com/incidentist/the_tuul with various improvements and versioned models removed.

## Quick start

Requirements: docker

1. Clone the project, or download and extract the zip file if you don't have git
2. Run it with `docker compose`.
3. Open http://localhost:8080/ in your browser.

```
git clone https://github.com/vctls/the_tuul.git
cd the_tuul
docker compose up
```

The image builds on the first run, and the first separation downloads the model it uses.
Both take a while the first time.

## Running the dev stack

The dev stack runs either on the host directly, or in Docker.

To run locally, it requires python 3.13, [poetry](http://python-poetry.org), npm and ffmpeg.
Install it on the host with `make install`.

Copy .env.example to .env and fill out the variables.
The dev compose stack needs that file, the main one runs without it.

Run it with `docker compose`:

```
docker compose -f compose.dev.yaml up
```

And open it on http://localhost:5173

Alternatively, run it directly with Poetry:

```
> make dev
```

And open it on http://localhost:8000

### Running Separate Separator App

`poetry run python -m api.separator_server`

It listens on port 8001. The app only sends work to it when `SEPARATOR_HOST` and `SEPARATOR_PORT` point at it.

To run it in a container with GPU access instead:

```
docker compose -f compose.yaml -f compose.gpu.yaml up
```

That one needs the NVIDIA container toolkit, and is untested.

## Build

To build the Docker image:

`> make build-docker`

## Credits

Original project https://github.com/incidentist/the_tuul by [Dan Kurtz](https://github.com/incidentist)

Vocal/instrumental separation is performed by [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator), which wraps a number of pretrained models
from the [Ultimate Vocal Remover](https://github.com/Anjok07/ultimatevocalremovergui) (UVR) community.
The Tüül does not redistribute the model weights. They are auto-downloaded by `audio-separator` on first use.

Models currently exposed in the UI:

- **MDX-Net** (`UVR_MDXNET_KARA_2`, `UVR-MDX-NET-Inst_HQ_3`). UVR core team ([Anjok07](https://github.com/Anjok07), [aufr33](https://github.com/aufr33))
- **Mel-Band Roformer (karaoke)**. [aufr33](https://github.com/aufr33) & [viperx](https://huggingface.co/viperx); newer variant by [becruily](https://huggingface.co/becruily)
- **BS-Roformer**. Original architecture by [lucidrains](https://github.com/lucidrains/BS-RoFormer); weights by [viperx](https://huggingface.co/viperx)

The UVR GUI is MIT-licensed and its maintainers ask third-party tools that use these models to credit UVR and the model authors.
If you use The Tüül to publish karaoke content, please pass that attribution along.
