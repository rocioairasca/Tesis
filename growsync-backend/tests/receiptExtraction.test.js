const test = require('node:test');
const assert = require('node:assert/strict');

const extraction = require(
  '../services/receiptExtraction'
);

const proposal = {
  supplier_name: 'Agrocampo',
  supplier_tax_id: null,
  document_number: '0005-00012023',
  document_date: '2026-11-10',
  document_type: 'Remito',
  lines: [
    {
      raw_description:
        '2.4 D LV ESTER ETIL HEXILICO (Baja volatilidad)',
      quantity: '420',
      unit: 'L',
      presentation: null,
      supplier_batch: null,
      expiration_date: null,
    },
  ],
  warnings: [],
};

function providerResponse(data = proposal) {
  return {
    ok: true,
    status: 200,

    async json() {
      return {
        id: 'resp_test',
        object: 'response',
        status: 'completed',
        error: null,
        incomplete_details: null,

        output: [
          {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            status: 'completed',

            content: [
              {
                type: 'output_text',
                text: JSON.stringify(data),
                annotations: [],
              },
            ],
          },
        ],
      };
    },
  };
}

async function capturePayload(file) {
  const originalFetch =
    global.fetch;

  const originalKey =
    process.env.OPENAI_API_KEY;

  const originalModel =
    process.env.RECEIPT_EXTRACTION_MODEL;

  let request;

  process.env.OPENAI_API_KEY =
    'test-key';

  process.env.RECEIPT_EXTRACTION_MODEL =
    'test-receipt-model';

  global.fetch = async (
    url,
    options,
  ) => {
    request = {
      url,
      options,
      body:
        JSON.parse(options.body),
    };

    return providerResponse();
  };

  try {
    const result =
      await extraction.extract({
        file,
      });

    return {
      request,
      result,
    };
  } finally {
    global.fetch =
      originalFetch;

    if (
      originalKey === undefined
    ) {
      delete process.env
        .OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY =
        originalKey;
    }

    if (
      originalModel === undefined
    ) {
      delete process.env
        .RECEIPT_EXTRACTION_MODEL;
    } else {
      process.env
        .RECEIPT_EXTRACTION_MODEL =
        originalModel;
    }
  }
}

test(
  'JPEG is sent to OpenAI as a high-detail input_image',
  async () => {
    const jpeg = Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x10,
      0x4a,
      0x46,
      0x49,
      0x46,
    ]);

    const {
      request,
      result,
    } = await capturePayload({
      buffer: jpeg,
      mimetype: 'image/jpeg',
      originalname:
        'remito.jpg',
    });

    assert.equal(
      request.url,
      'https://api.openai.com/v1/responses',
    );

    assert.equal(
      request.options.method,
      'POST',
    );

    assert.equal(
      request.options.headers
        .Authorization,
      'Bearer test-key',
    );

    assert.equal(
      request.body.model,
      'test-receipt-model',
    );

    assert.equal(
      request.body.store,
      false,
    );

    const content =
      request.body.input[0]
        .content;

    const image =
      content.find(
        item =>
          item.type ===
          'input_image',
      );

    assert.ok(image);

    assert.equal(
      image.detail,
      'high',
    );

    assert.ok(
      image.image_url.startsWith(
        'data:image/jpeg;base64,'
      ),
    );

    assert.equal(
      content.some(
        item =>
          item.type ===
          'input_file',
      ),
      false,
    );

    assert.equal(
      result.lines[0].quantity,
      '420',
    );
  },
);

test(
  'PDF is sent to OpenAI as a high-detail input_file',
  async () => {
    const pdf = Buffer.from(
      '%PDF-1.7 synthetic',
    );

    const {
      request,
      result,
    } = await capturePayload({
      buffer: pdf,
      mimetype:
        'application/pdf',
      originalname:
        'remito.pdf',
    });

    const content =
      request.body.input[0]
        .content;

    const file =
      content.find(
        item =>
          item.type ===
          'input_file',
      );

    assert.ok(file);

    assert.equal(
      file.filename,
      'remito.pdf',
    );

    assert.equal(
      file.detail,
      'high',
    );

    assert.ok(
      file.file_data.startsWith(
        'data:application/pdf;base64,'
      ),
    );

    assert.equal(
      content.some(
        item =>
          item.type ===
          'input_image',
      ),
      false,
    );

    assert.equal(
      result.document_number,
      '0005-00012023',
    );
  },
);

test(
  'receipt extraction schema and instructions exclude economics',
  () => {
    const serialized =
      JSON.stringify({
        schema:
          extraction.jsonSchema,
        instructions:
          extraction.instructions,
      }).toLowerCase();

    /*
     * Campos económicos no deben existir
     * como salida estructurada.
     */
    const schema =
      JSON.stringify(
        extraction.jsonSchema,
      ).toLowerCase();

    for (const forbidden of [
      '"price"',
      '"unit_price"',
      '"subtotal"',
      '"total"',
      '"currency"',
      '"tax"',
      '"iva"',
      '"discount"',
    ]) {
      assert.equal(
        schema.includes(forbidden),
        false,
        forbidden,
      );
    }

    /*
     * Las instrucciones sí deben
     * contener la prohibición explícita
     * de extraer información económica.
     */
    assert.ok(
      serialized.includes(
        'precio'
      ) ||
      serialized.includes(
        'prices'
      ),
    );
  },
);