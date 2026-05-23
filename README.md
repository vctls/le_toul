# The Tüül - A Karaoke Video Maker Thing

Normally it takes a long time to make a decent karaoke video. You need to separate the music from the vocals, and painstakingly adjust the timing of every syllable. What we try to do here is use some shortcuts to make videos that are 80% perfect in 20% of the time.

This is a fork of the original project https://github.com/incidentist/the_tuul by [Dan Kurtz](https://github.com/incidentist)
with various improvements.

## Install
The app can be run either on the host directly, or in a Docker container.

To run locally, it requires python 3, [poetry](http://python-poetry.org), npm and ffmpeg. Install it on the host with `make install`.

Copy .env.example to .env and fill out the variables.

## Run
This is a FastAPI app. Run it like so:
```
> make dev
```

Load up http://localhost:8000 and follow the instructions!

Alternatively, run it with `docker compose`:  
```
docker compose -f compose.dev.yaml up
```

And open it on http://localhost:5173/bundles/

### Running Separate Separator App

`poetry run python -m api.separator_server`

## Build
To build the Docker image:

`> make docker-build`

## Credits

Vocal/instrumental separation is performed by [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator), which wraps a number of pretrained models from the [Ultimate Vocal Remover](https://github.com/Anjok07/ultimatevocalremovergui) (UVR) community. The Tüül does not redistribute the model weights. They are auto-downloaded by `audio-separator` on first use.

Models currently exposed in the UI:

- **MDX-Net** (`UVR_MDXNET_KARA_2`, `UVR-MDX-NET-Inst_HQ_3`). UVR core team ([Anjok07](https://github.com/Anjok07), [aufr33](https://github.com/aufr33))
- **Mel-Band Roformer (karaoke)**. [aufr33](https://github.com/aufr33) & [viperx](https://huggingface.co/viperx); newer variant by [becruily](https://huggingface.co/becruily)
- **BS-Roformer**. Original architecture by [lucidrains](https://github.com/lucidrains/BS-RoFormer); weights by [viperx](https://huggingface.co/viperx)

The UVR GUI is MIT-licensed and its maintainers ask third-party tools that use these models to credit UVR and the model authors. If you use The Tüül to publish karaoke content, please pass that attribution along.

