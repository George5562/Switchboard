import { Config } from './config.js';
export interface SuiteTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: {
      action: {
        type: string;
        enum: string[];
      };
      subtool?: {
        type: string;
      };
      args?: {
        type: string;
      };
    };
    required: string[];
  };
}
export declare function listTopLevelTools(config: Config): Promise<SuiteTool[]>;
export declare function handleSuiteCall(
  toolName: string,
  params: any,
  config: Config,
): Promise<any>;
export declare function closeAllClients(): void;
//# sourceMappingURL=router.d.ts.map
