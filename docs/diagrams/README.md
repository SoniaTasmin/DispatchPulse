# Diagrams

The `.dot` files are the source of truth for the diagrams in the main README. After editing
one, regenerate its SVG from this directory with [Graphviz](https://graphviz.org/):

```bash
dot -Tsvg architecture.dot -o ../images/architecture.svg
dot -Tsvg event-delivery.dot -o ../images/event-delivery.svg
dot -Tsvg observability.dot -o ../images/observability.svg
```

Without a local Graphviz install, a one-off container works the same way, e.g.
`docker run --rm -v "$PWD/..":/docs -w /docs/diagrams <graphviz-image> dot -Tsvg …`.
