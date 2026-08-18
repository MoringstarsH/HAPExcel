import { describe, expect, it } from "vitest";
import { buildNativeFilter, filterOptionsForControl, mergeQueryParams } from "./query";

describe("query helpers", () => {
  it("builds a native text contains filter", () => {
    expect(buildNativeFilter({
      control: { controlId: "name", type: 2 },
      operator: "contains",
      value: "钢筋"
    })).toEqual(expect.objectContaining({
      controlId: "name",
      dataType: 2,
      spliceType: 1,
      filterType: 1,
      values: ["钢筋"]
    }));
  });

  it("builds a numeric range and typed options", () => {
    const filter = buildNativeFilter({
      control: { controlId: "amount", type: 6 },
      operator: "between",
      value: ["10", "20"]
    });
    expect(filter).toEqual(expect.objectContaining({ minValue: "10", maxValue: "20", filterType: 11 }));
    expect(filterOptionsForControl({ type: 9 }).map((item) => item.key)).toContain("equals");
  });

  it("merges local filters with external filters and carries sorting", () => {
    const result = mergeQueryParams({ filters: [{ controlId: "external" }] }, {
      filters: [{ controlId: "local" }],
      sortId: "arrival",
      isAsc: true
    });
    expect(result.filters).toEqual([{ controlId: "external" }, { controlId: "local" }]);
    expect(result.sortId).toBe("arrival");
    expect(result.isAsc).toBe(true);
  });
});
