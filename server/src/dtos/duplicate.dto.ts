import { createZodDto } from 'nestjs-zod';
import { AssetResponseSchema } from 'src/dtos/asset-response.dto';
import * as z from 'zod';

const DuplicateResponseSchema = z
  .object({
    duplicateId: z.string().describe('Duplicate group ID'),
    assets: z.array(AssetResponseSchema).describe('Duplicate assets'),
  })
  .meta({ id: 'DuplicateResponseDto' });

export class DuplicateResponseDto extends createZodDto(DuplicateResponseSchema) {}
