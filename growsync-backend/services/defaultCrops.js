const DEFAULT_CROPS = ['Soja', 'Maíz', 'Trigo', 'Girasol', 'Sorgo'];

const seedDefaultCrops = async (client, companyId) => {
  if (!companyId) return;

  await client.query(
    `
    INSERT INTO crops (company_id, name)
    SELECT $1, crop_name
    FROM unnest($2::text[]) AS seed(crop_name)
    ON CONFLICT (company_id, (lower(btrim(name)))) DO NOTHING;
    `,
    [companyId, DEFAULT_CROPS]
  );
};

module.exports = {
  DEFAULT_CROPS,
  seedDefaultCrops,
};
