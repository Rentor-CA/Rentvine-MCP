export TOKEN=f48cc49ce17a1a5be556be8e1d9c926df956076a87abed3005c7090c367b5f2b
URL=http://127.0.0.1:18009/mcp        # or https://server.rentor.com:8003/mcp

npx @modelcontextprotocol/inspector --cli $URL \
  --header "Authorization: Bearer $TOKEN" --method tools/list

npx @modelcontextprotocol/inspector --cli $URL \
  --header "Authorization: Bearer $TOKEN" \
  --method tools/call --tool-name list_tenants --tool-arg page_size=100

npx @modelcontextprotocol/inspector --cli $URL \
  --header "Authorization: Bearer $TOKEN" \
  --method resources/read --uri rentvine://api-docs