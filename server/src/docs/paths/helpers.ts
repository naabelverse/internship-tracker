export const AUTHENTICATED = [{ bearerAuth: [] }];

export function ref(name: string): Record<string, unknown> {
  return { $ref: `#/components/schemas/${name}` };
}

export function arrayOf(name: string): Record<string, unknown> {
  return { type: 'array', items: ref(name) };
}

export function objectOf(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties };
}

/** Wraps a data schema in the envelope every successful response uses. */
export function envelope(data: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data,
      message: { type: 'string' },
      meta: ref('PaginationMeta'),
    },
  };
}

export function jsonBody(schema: Record<string, unknown>): Record<string, unknown> {
  return { required: true, content: { 'application/json': { schema } } };
}

export function ok(
  description: string,
  data: Record<string, unknown>,
  status = '200',
): Record<string, unknown> {
  return {
    [status]: { description, content: { 'application/json': { schema: envelope(data) } } },
  };
}

function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: { 'application/json': { schema: ref('Error') } },
  };
}

export const COMMON_ERRORS = {
  '400': errorResponse('The request failed validation'),
  '401': errorResponse('Authentication is missing or no longer valid'),
  '404': errorResponse('Not found, or not owned by the signed in account'),
};

export const RATE_LIMITED = {
  '429': errorResponse('Too many attempts, the limit window has not elapsed'),
};

export function pathParam(name: string, description: string): Record<string, unknown> {
  return {
    name,
    in: 'path',
    required: true,
    description,
    schema: { type: 'string' },
  };
}

export function queryParam(
  name: string,
  schema: Record<string, unknown>,
  description: string,
  required = false,
): Record<string, unknown> {
  return { name, in: 'query', required, description, schema };
}
