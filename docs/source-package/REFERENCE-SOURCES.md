# Nguồn tham khảo và giới hạn xác minh

Đây là danh sách nguồn đã tham khảo ngày 03/10/2026, không phải bản mirror offline. Agent cần đọc lại tài liệu hiện hành và pin phiên bản khi chọn thư viện/runtime.

- GoClaw docs: https://docs.goclaw.sh/ ; bản đầy đủ: https://docs.goclaw.sh/llms-full.txt
- GoClaw upstream: https://github.com/nextlevelbuilder/goclaw
- Twenty: https://github.com/twentyhq/twenty
- Twenty model: https://docs.twenty.com/getting-started/core-concepts/data-model
- Twenty layout: https://docs.twenty.com/getting-started/core-concepts/layout
- Twenty workflows: https://docs.twenty.com/getting-started/core-concepts/workflows
- Twenty license: https://github.com/twentyhq/twenty/blob/main/LICENSE
- Workers runtime: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Static assets: https://developers.cloudflare.com/workers/static-assets/
- D1 batch: https://developers.cloudflare.com/d1/worker-api/d1-database/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 recovery: https://developers.cloudflare.com/d1/reference/time-travel/
- Queues delivery: https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- Workflows: https://developers.cloudflare.com/workflows/
- MISA AMIS API: https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html

D1 batch/limits, Queues delivery và MISA API docs đã được đối chiếu trong phiên phản biện. D1 production tests, MISA account access, GoClaw live deployment và full CRM implementation chưa được thực hiện. Twenty source đã tham khảo tại commit 5f74fd6dc0f5ba879bff30fc12e46997f3fb5599; không coi đó là phiên bản mới nhất hoặc ABM đã tích hợp mã. License phải kiểm tra theo phần mã thực sự tái sử dụng.
