# Replay mapping: showing a model's own variables

By default a replay draws the four state codes the model's `on_week` hook reports (`to_do`, `queued`, `in_progress`, `finished`). To show something else, declare a mapping in `render.yaml`. The exporter records each named variable for every building every week, and the replay page draws it.

```yaml
replay:
  weeks: [0, 20, 59]
  mapping:
    - variable: building.wealth          # read from each building in the hook
      channel: wall                      # colour the wall
      scale: {type: sequential, domain: [0, 100], colours: ["#f4e9c8", "#c8452f"], label: Wealth}
    - variable: building.state           # the state string, shown as geometry
      channel: overlay
      scale:
        type: categorical
        values:
          in_progress: {overlay: scaffold, label: Infectious}
          to_do: {overlay: null, label: Susceptible}
```

## Variables

`building.<name>` is an attribute of the building object. `owner.<name>` is an attribute of the household whose id is the building's `owner_id`. A value must be a number or a boolean (true is 1). A building that does not have the attribute, an owner that does not exist, or a value that is not a number is recorded as missing and drawn as "no data", never as zero.

The hook stays read-only, as in [model-interface.md](model-interface.md).

## Channels and scales

| channel | scale | what it does |
|---|---|---|
| `wall` | `sequential`: `domain` `[low, high]`, `colours` (two or more `#rrggbb`) | Walls blend through the colours; a value outside the domain is clamped. |
| `wall` | `categorical`: `values` maps each value to `{colour, label}` | Walls take the colour of the value. |
| `overlay` | `categorical`: `values` maps each value to `{overlay, label}` | `overlay` is `scaffold`, `solar`, `band`, `marker` or `null`. |

Every entry needs a label. The legend on the page is generated from the scales, so it can only describe what is drawn.

Not built: height as a channel, and agents (people and vehicles) driven by model agents.
