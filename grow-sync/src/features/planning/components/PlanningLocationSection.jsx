import React from "react";
import { Form, Select } from "antd";
import { EnvironmentOutlined } from "../../../components/AppIcons";
import PlanningFormSection from "./PlanningFormSection";
import EffectiveAreaFields from "./EffectiveAreaFields";
import { formatHa } from "../planningFormat.mjs";

const hasMixedLotSelections = (value = []) => {
    const selectedByLot = value.reduce((acc, key) => {
        const [type, lotId] = String(key || '').split(':');
        if (!lotId) return acc;

        const current = acc.get(lotId) || {
            full: false,
            subLots: 0,
        };

        if (type === 'sub') current.subLots += 1;
        if (type === 'lot') current.full = true;

        acc.set(lotId, current);
        return acc;
    }, new Map());

    return Array.from(selectedByLot.values()).some(
        (item) => item.full && item.subLots > 0
    );
};

export default function PlanningLocationSection({
  lotSelectionOptions,
  selectedAreaRows,
  selectedActivityType,
  selectedPlanningArea,
  isEditingCompleted,
}) {
  return (
    <PlanningFormSection
      title="Ubicación"
      description="Seleccioná lotes, sublotes o una superficie manual."
      icon={EnvironmentOutlined}
    >
      <Form.Item
        name="lot_selection_keys"
        label="Lotes y sublotes"
        rules={
          isEditingCompleted
            ? []
            : [
                {
                  required: true,
                  message: "Seleccioná al menos un lote o sublote",
                },
                {
                  validator: (_, value = []) =>
                    hasMixedLotSelections(value)
                      ? Promise.reject(
                          new Error(
                            "No combines un lote completo con sublotes del mismo lote"
                          )
                        )
                      : Promise.resolve(),
                },
              ]
        }
      >
        <Select
          disabled={isEditingCompleted}
          mode="multiple"
          placeholder="Seleccioná lotes completos o sublotes"
          options={lotSelectionOptions}
          optionFilterProp="label"
        />
      </Form.Item>

      <EffectiveAreaFields
        selections={selectedAreaRows}
        activity={selectedActivityType}
        completed={isEditingCompleted}
      />

      <div
        style={{
          marginBottom: 16,
          color: "#595959",
          fontSize: 13,
        }}
      >
        Superficie total:{" "}
        <strong>{formatHa(selectedPlanningArea)}</strong>
      </div>
    </PlanningFormSection>
  );
}