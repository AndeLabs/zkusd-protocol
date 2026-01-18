'use client';

import { PositionsSummary } from '@/components/positions';
import { StabilityPoolForm } from '@/components/stability-pool';
import { Card, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { OpenVaultForm } from '@/components/vault';

export function ActionCard() {
  return (
    <Card className="p-0 overflow-hidden">
      <Tabs defaultValue="borrow">
        <div className="border-b border-zinc-800">
          <TabsList className="w-full">
            <TabsTrigger value="borrow" className="flex-1">
              Borrow
            </TabsTrigger>
            <TabsTrigger value="earn" className="flex-1">
              Earn
            </TabsTrigger>
            <TabsTrigger value="manage" className="flex-1">
              Manage
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="p-6">
          <TabsContent value="borrow">
            <OpenVaultForm />
          </TabsContent>

          <TabsContent value="earn">
            <StabilityPoolForm />
          </TabsContent>

          <TabsContent value="manage">
            <PositionsSummary />
          </TabsContent>
        </div>
      </Tabs>
    </Card>
  );
}
