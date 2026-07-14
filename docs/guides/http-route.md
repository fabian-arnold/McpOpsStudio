---
title: Publish an HTTP route
description: Bind a Function to an HTTP method and path and invoke it.
---

# Publish an HTTP route

<img src="/demos/http-route.gif" alt="Demo of an HTTP API route binding and endpoint catalog">

## Bind the Function

1. Open **HTTP APIs** and select the target API.
2. On **Bindings**, choose **Add route**.
3. Select the Function, HTTP method, binding path, request mapping, and enabled
   state.
4. Verify authentication and granted Function permissions.
5. Deploy the Project to Development.

## Invoke the route

Use the exact Development URL shown by the application:

```bash
curl "$HTTP_URL/v1/customers/search?query=ada&limit=10" \
  -H "x-api-key: $HTTP_API_KEY"
```

Path parameters, query values, selected headers, and JSON body fields are mapped
to Function input before schema validation. The response is the validated
Function output using the binding's HTTP response behavior.

## Related guides

- [HTTP APIs](../app/http-apis.md)
- [Executions](../app/executions.md)
