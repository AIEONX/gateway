import {
  SpanKind,
  SpanStatusCode,
  type TracerProvider,
  trace,
} from '@opentelemetry/api';
import {
  ATTR_HTTP_REQUEST_HEADER,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_HEADER,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_URL_FULL,
  ATTR_HTTP_ROUTE,
} from '@opentelemetry/semantic-conventions';
import type { Context, Env, Input } from 'hono';
import { createMiddleware } from 'hono/factory';

const PACKAGE_NAME = 'AIEONX';
const PACKAGE_VERSION = '0.1.0';

export type OtelOptions =
  | {
      augmentSpan?: false;
      tracerProvider?: TracerProvider;
    }
  | {
      augmentSpan: true;
    };

export const otel = <
  E extends Env = any,
  P extends string = any,
  I extends Input = {},
>(
  options: OtelOptions = {}
) => {
  if (options.augmentSpan) {
    return createMiddleware<E, P, I>(async (c, next) => {
      const result = await next();
      const span = trace.getActiveSpan();
      if (span != null) {
        const route = c.req.matchedRoutes[c.req.matchedRoutes.length - 1];
        span.setAttribute(ATTR_HTTP_ROUTE, route.path);
        span.updateName(`${c.req.method} ${route.path}`);
      }
      return result;
    });
  }
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(PACKAGE_NAME, PACKAGE_VERSION);
  return createMiddleware<E, P, I>(async (c, next) => {
    const route = c.req.matchedRoutes[c.req.matchedRoutes.length - 1];
    await tracer.startActiveSpan(
      `${c.req.method} ${route.path}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          [ATTR_HTTP_REQUEST_METHOD]: c.req.method,
          [ATTR_URL_FULL]: c.req.url,
          [ATTR_HTTP_ROUTE]: route.path,
        },
      },
      async (span) => {
        for (const [name, value] of Object.entries(c.req.header())) {
          span.setAttribute(ATTR_HTTP_REQUEST_HEADER(name), value);
        }
        try {
          const start = Date.now();
          await next();
          span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, c.res.status);

          for (const [name, value] of c.res.headers.entries()) {
            span.setAttribute(ATTR_HTTP_RESPONSE_HEADER(name), value);
          }
          const llmMessage = await processLog(c, start);
          // span.setAttribute('gen_ai.prompt', llmMessage);
          span.setAttributes(mapJsonToSpanAttributes(llmMessage));
          if (c.error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(c.error),
            });
          }
        } catch (e) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          console.error(e);
          // throw e;
        } finally {
          span.end();
        }
      }
    );
  });
};

async function processLog(c: Context, start: number) {
  const ms = Date.now() - start;
  console.log('Sesha was here');
  if (!c.req.url.includes('/v1/')) return '';

  const requestOptionsArray = c.get('requestOptions');
  if (!requestOptionsArray?.length) {
    return '';
  }

  if (requestOptionsArray[0].requestParams.stream) {
    requestOptionsArray[0].response = {
      message: 'The response was a stream.',
    };
  } else {
    const response = await c.res.clone().json();
    const maxLength = 1000; // Set a reasonable limit for the response length
    const responseString = JSON.stringify(response);
    requestOptionsArray[0].response =
      responseString.length > maxLength
        ? JSON.parse(responseString.substring(0, maxLength) + '...')
        : response;
  }

  return JSON.stringify({
    time: new Date().toLocaleString(),
    method: c.req.method,
    endpoint: c.req.url.split(':8787')[1],
    status: c.res.status,
    duration: ms,
    requestOptions: requestOptionsArray,
  });
}

function mapJsonToSpanAttributes(message: string) {
  const parsedMessage: any = JSON.parse(message);
  const attributes: Record<string, any> = {};

  const requestOption = parsedMessage.requestOptions[0];
  const requestBody = requestOption.transformedRequest.body;
  const response = requestOption.response;

  // General Span Attributes
  attributes['gen_ai.endpoint'] = parsedMessage.endpoint;
  attributes['gen_ai.system'] = requestOption.providerOptions.provider;
  attributes['gen_ai.environment'] = 'production';
  attributes['gen_ai.operation.name'] =
    parsedMessage.endpoint.split('/').pop() || 'chat';

  // Request Attributes
  attributes['gen_ai.request.model'] = requestBody.model;
  attributes['gen_ai.request.is_stream'] = requestBody.stream;

  // Response Attributes
  attributes['gen_ai.response.id'] = response.id;
  attributes['gen_ai.response.finish_reasons'] =
    response.choices[0].finish_reason;

  // Usage Attributes
  attributes['gen_ai.usage.input_tokens'] = response.usage.prompt_tokens;
  attributes['gen_ai.usage.output_tokens'] = response.usage.completion_tokens;
  attributes['gen_ai.usage.total_tokens'] = response.usage.total_tokens;
  attributes['gen_ai.usage.cost'] = calculateCost(response.usage);

  // Content Attributes
  attributes['gen_ai.prompt'] = requestBody.messages
    .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
    .join('\n');
  attributes['gen_ai.completion'] = response.choices[0].message.content;

  return attributes;
}

function calculateCost(usage: {
  prompt_tokens: number;
  completion_tokens: number;
}): number {
  // Example pricing: $0.03/1k input tokens, $0.06/1k output tokens
  return usage.prompt_tokens * 0.00003 + usage.completion_tokens * 0.00006;
}
