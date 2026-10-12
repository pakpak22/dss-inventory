import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 공용 패키지(@dss/ui)는 git 서브모듈이라 이 저장소의 규칙으로 검사하지 않는다. CLAUDE.md 9-5절.
    "vendor/dss-ui/**",
    // 조각 2에서 푸는 A/S 엑셀 코드 묶음. 고치지 않는 코드라 검사에서도 뺀다.
    "src/lib/xlsx/**",
  ]),
]);

export default eslintConfig;
