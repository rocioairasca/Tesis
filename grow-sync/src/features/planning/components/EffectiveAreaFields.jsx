import React from "react";
import { Form, InputNumber, Select } from "antd";
import { partialAreaAllowed } from "../effectiveArea.mjs";
import {
  formatPlanningNumber,
  formatPercent,
} from "../planningFormat.mjs";

export default function EffectiveAreaFields({
  selections,
  activity,
  completed = false,
}) {
  const form = Form.useFormInstance();
  const modes = Form.useWatch("selection_modes", form) || {};
  const areas = Form.useWatch("effective_areas", form) || {};

  return (
    <div className="planning-selection-areas">
      {selections.map((item) => {
        const sub = Boolean(item.sub_lot_id);

        const initial =
          item.selection_mode ||
          (sub
            ? "sub_lot"
            : Number(item.effective_area_ha) < Number(item.area_ha)
              ? "manual_portion"
              : "full_lot");

        const mode = modes[item.key] || initial;
        const partial = mode === "manual_portion" || sub;

        const area =
          areas[item.key] ??
          item.effective_area_ha ??
          item.area_ha;

        const lotArea = Number(item.area_ha);

        const percentage =
          lotArea > 0
            ? (Number(area) / lotArea) * 100
            : 0;

        return (
          <div key={item.key} className="planning-selection-area">
            <strong>{item.name}</strong>

            <Form.Item
              name={["selection_modes", item.key]}
              label="Tipo de selección"
              initialValue={initial}
            >
              <Select
                disabled={completed || sub}
                options={
                  sub
                    ? [
                        {
                          value: "sub_lot",
                          label: "Sublote existente",
                        },
                      ]
                    : [
                        {
                          value: "full_lot",
                          label: "Lote completo",
                        },
                        {
                          value: "manual_portion",
                          label: "Porción del lote",
                          disabled: !partialAreaAllowed(activity),
                        },
                      ]
                }
                onChange={(nextMode) => {
                  if (nextMode === "full_lot") {
                    form.setFieldValue(
                      ["effective_areas", item.key],
                      item.area_ha
                    );
                  }
                }}
              />
            </Form.Item>

            <Form.Item
              name={["effective_areas", item.key]}
              label="Superficie a trabajar"
              initialValue={
                item.effective_area_ha ?? item.area_ha
              }
              rules={[
                {
                  required: true,
                  message: "Indicá la superficie a trabajar.",
                },
                {
                  validator: (_, value) => {
                    const validFormat =
                      /^\d+(?:[.,]\d{1,4})?$/.test(
                        String(value)
                      );

                    const numericValue = Number(value);

                    return validFormat &&
                      numericValue > 0 &&
                      numericValue <= Number(item.area_ha)
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error(
                            "Indicá una superficie mayor que cero, sin superar la superficie seleccionada."
                          )
                        );
                  },
                },
              ]}
            >
              <InputNumber
                disabled={
                  completed ||
                  !partial ||
                  !partialAreaAllowed(activity)
                }
                decimalSeparator=","
                parser={(value) =>
                  value?.replace(",", ".")
                }
                suffix="ha"
              />
            </Form.Item>

            <div className="planning-selection-summary">
              Superficie {sub ? "del sublote" : "del lote"}:{" "}
              {formatPlanningNumber(item.area_ha)} ha
              <br />
              Superficie seleccionada:{" "}
              {formatPlanningNumber(area)} ha (
              {formatPercent(percentage)})
            </div>
          </div>
        );
      })}

      {!partialAreaAllowed(activity) &&
        selections.length > 0 && (
          <p>
            Esta actividad utiliza toda la superficie
            seleccionada. Podés seleccionar un sublote
            existente.
          </p>
        )}
    </div>
  );
}
