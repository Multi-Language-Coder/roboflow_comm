# Roboflow Communicator

An Angular single-page app for running inference against a deployed
[Roboflow](https://roboflow.com) model and visualizing the result. Enter your
credentials, submit image / video / text data, and the UI adapts its display to
the type of data the model processed.

## Features

- **Config form** — workspace, project, version, and API key, plus
  confidence / overlap thresholds for vision models.
- **Adaptive data input** — a segmented control switches between an image file
  picker, a video file picker (a captured frame is sent), and a text area.
- **One-click inference** — the *Run Inference* button POSTs to the appropriate
  Roboflow hosted endpoint using the entered credentials and payload.
- **Adaptive results**
  - *Object detection / instance segmentation* — bounding boxes, class labels,
    and segmentation polygons drawn on a canvas over the original image.
  - *Semantic segmentation* — the returned mask overlaid on the image.
  - *Classification* — ranked class list with confidence bars.
  - *Text / document* — extracted entities highlighted inline in the text flow.
- **Raw JSON** — a collapsible panel exposing the full response (confidence
  scores, coordinate arrays, metadata).

## Endpoints

The task selector chooses the hosted subdomain automatically:

| Task                   | Endpoint                        |
| ---------------------- | ------------------------------- |
| Object Detection       | `detect.roboflow.com`           |
| Instance Segmentation  | `outline.roboflow.com`          |
| Semantic Segmentation  | `segment.roboflow.com`          |
| Classification         | `classify.roboflow.com`         |

The model URL is built as `<subdomain>/<project>/<version>`. Text models have no
universal Roboflow endpoint, so a custom endpoint URL field is provided; the app
POSTs `{ "text": "…" }` and highlights any returned entity spans.

> Notes: the browser cannot stream an entire video, so for video input a single
> frame is captured and sent to the image endpoint. Credentials never leave the
> browser except in the request to the inference endpoint you configure.

## Development

```bash
npm start        # dev server at http://localhost:4200
npm run build    # production build into dist/
```

## Deployment (Netlify)

Netlify build settings are committed in [`netlify.toml`](netlify.toml):

- **Build command:** `npm run build`
- **Publish directory:** `dist/roboflow_communicator/browser`

The publish directory must point at the `browser` sub-folder that Angular's
application builder emits — pointing it at `dist` alone causes the
`@netlify/angular-runtime` plugin to fail.

Built with Angular 22 (standalone components, signals, zoneless change
detection).
