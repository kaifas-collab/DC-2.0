"use client"

import { useState } from "react"
import { Loader2, Plus, AlertCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

interface AddServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Called after a server is successfully added, so the parent can refresh its server list.
  onSuccess: () => void
}

const EMPTY_FORM = { name: "", baseURL: "", token: "", location: "" }

export default function AddServerDialog({ open, onOpenChange, onSuccess }: AddServerDialogProps) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  const reset = () => {
    setForm(EMPTY_FORM)
    setError(null)
    setIsSubmitting(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (isSubmitting) return // don't let the dialog close mid-request
    if (!next) reset()
    onOpenChange(next)
  }

  const canSubmit =
    form.name.trim() && form.baseURL.trim() && form.token.trim() && form.location.trim() && !isSubmitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          baseURL: form.baseURL.trim(),
          token: form.token.trim(),
          location: form.location.trim(),
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        setError(data.error || "Failed to add server")
        setIsSubmitting(false)
        return
      }

      reset()
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add server")
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle>Add FRS Server</DialogTitle>
          <DialogDescription>
            The server is tested for connectivity before it&apos;s saved. Once added, it&apos;s
            registered with the sync engine and synced immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="server-name">Name</Label>
            <Input
              id="server-name"
              placeholder="NYN_FRS_SERVER"
              value={form.name}
              onChange={update("name")}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="server-url">Base URL</Label>
            <Input
              id="server-url"
              placeholder="http://100.77.135.165/"
              value={form.baseURL}
              onChange={update("baseURL")}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="server-token">Token</Label>
            <Input
              id="server-token"
              placeholder="FRS API token"
              value={form.token}
              onChange={update("token")}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="server-location">Location</Label>
            <Input
              id="server-location"
              placeholder="NYN/Nainy"
              value={form.location}
              onChange={update("location")}
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="gap-2">
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Testing &amp; adding...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Test &amp; Add Server
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
