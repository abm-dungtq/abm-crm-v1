---
phase: 5
title: Phương án tối ưu codebase
status: completed
runtime: antigravity
depends_on: [1, 2, 3]
---

# Phase 05 — Phương án tối ưu (chỉ tài liệu)

## Goal

Viết một phương án tối ưu có thứ tự ưu tiên để user chọn việc làm tiếp.

## Input

- Ba báo cáo 01–03 trong `reports/` của plan này.
- Code hiện tại.

## Scope

- Chỉ ghi `plans/261004-2139-codebase-debug-optimization/reports/optimization-proposal.md`.
- Không sửa code.

## Chạy song song với phase 04

Phase 04 đang sửa 10 mục trong mục "Danh sách sửa đã chốt" của `phase-04-fix-confirmed-bugs.md`. Không đề xuất lại các mục đó, chỉ ghi "đang sửa ở đợt vá lỗi". Riêng phần còn lại của mục 3 (cột tên đã fold) vẫn thuộc phase này. Các mục trong "Không làm trong phase này" phải có trong đề xuất.

## Steps

1. Gom mục "Cơ hội tối ưu" và các phát hiện medium/low chưa sửa.
2. Chia thành các nhóm:
   - hiệu năng D1 và CPU của Worker;
   - bundle và render web;
   - cấu trúc và code trùng lặp;
   - độ phủ test;
   - vận hành: log, backup, deploy.
3. Mỗi đề xuất ghi:
   - vấn đề kèm bằng chứng `file:dòng`;
   - cách làm;
   - lợi ích;
   - công sức (S/M/L);
   - rủi ro;
   - có đổi contract hay không.

   Xếp hạng các đề xuất theo tỉ lệ lợi ích trên công sức.
4. Cuối báo cáo, nêu 3–5 việc nên làm trước và ghi rõ việc nào cần user quyết định.

## Verify

- Báo cáo tồn tại. Mỗi đề xuất có bằng chứng `file:dòng` đã kiểm trên code.
- `git status --short` không có thay đổi nào ngoài file báo cáo.
