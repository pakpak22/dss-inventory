/**
 * 항목 19종 (REQUIREMENTS 4-1절, DESIGN 4-1절의 코드 제안). 현황판의 「항목」 칸 글자와 같다.
 *
 * 이것은 데모가 아니라 **실제 기준 자료**다 — 엑셀 가져오기(조각 5)가 이 한글 이름으로 대조한다.
 * 차례는 현황판에서 많이 쓰인 순서로 두고 「기타」는 맨 뒤. 관리자가 설정 화면(조각 3 이후)에서 바꾼다.
 */
export const PART_ITEM_SEED: ReadonlyArray<{ code: string; name: string }> = [
  { code: "PCB", name: "PCB" },
  { code: "SHEET_METAL", name: "판금" },
  { code: "CAPACITOR", name: "콘덴서" },
  { code: "FUSE", name: "퓨즈" },
  { code: "SCREW", name: "나사" },
  { code: "VVC", name: "바리콘" },
  { code: "CABLE", name: "케이블" },
  { code: "IGBT", name: "IGBT" },
  { code: "FITTING", name: "피팅" },
  { code: "FLOW_METER", name: "유량계" },
  { code: "TRANSFORMER", name: "트랜스" },
  { code: "FAN", name: "팬" },
  { code: "CONTROLLER", name: "컨트롤러" },
  { code: "COUPLING", name: "커플링" },
  { code: "CONNECTOR", name: "커넥터" },
  { code: "RESISTOR", name: "저항" },
  { code: "HOSE", name: "호스" },
  { code: "MOTOR", name: "모터" },
  { code: "ETC", name: "기타" },
];
