import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { McpApiClient } from './mcp-api-client';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [DiscoveryModule],
  controllers: [McpController],
  providers: [McpApiClient, McpService],
})
export class McpModule {}
