import { useState } from 'react';
import { useServices } from '@/hooks/useServices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Clock, DollarSign } from 'lucide-react';
import { Service } from '@/types/database';

export function Services() {
  const { services, addService, updateService, deleteService } = useServices();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    duration: '',
    active: true,
    askDescription: false,
  });

  const resetForm = () => {
    setFormData({ name: '', description: '', price: '', duration: '', active: true, askDescription: false });
    setEditingService(null);
  };

  const openEditDialog = (service: Service) => {
    setEditingService(service);
    setFormData({
      name: service.name,
      description: service.description,
      price: service.price.toString(),
      duration: service.duration.toString(),
      active: service.active,
      askDescription: (service as any).askDescription ?? false,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const serviceData = {
      name: formData.name,
      description: formData.description,
      price: parseFloat(formData.price),
      duration: parseInt(formData.duration),
      active: formData.active,
      askDescription: formData.askDescription,
    };

    if (editingService) {
      updateService(editingService.id, serviceData);
    } else {
      addService(serviceData);
    }

    setIsDialogOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Tem certeza que deseja excluir este serviço?')) {
      deleteService(id);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(price);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">Serviços</h1>
          <p className="text-muted-foreground mt-1">
            Configure os serviços oferecidos e seus valores
          </p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="btn-glow">
              <Plus size={18} className="mr-2" />
              Novo Serviço
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-display">
                {editingService ? 'Editar Serviço' : 'Novo Serviço'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome do Serviço</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Troca de Óleo"
                  className="bg-secondary border-border"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descrição</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Descreva o serviço..."
                  className="bg-secondary border-border resize-none"
                  rows={3}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="price">Preço (R$)</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    placeholder="150.00"
                    className="bg-secondary border-border"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="duration">Duração (min)</Label>
                  <Input
                    id="duration"
                    type="number"
                    min="15"
                    step="15"
                    value={formData.duration}
                    onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                    placeholder="30"
                    className="bg-secondary border-border"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="active">Serviço Ativo</Label>
                <Switch
                  id="active"
                  checked={formData.active}
                  onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="askDescription">Pedir descrição do problema ao agendar</Label>
                <Switch
                  id="askDescription"
                  checked={formData.askDescription}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, askDescription: checked })
                  }
                />
              </div>

              <Button type="submit" className="w-full btn-glow">
                {editingService ? 'Salvar Alterações' : 'Criar Serviço'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map((service) => (
          <div 
            key={service.id} 
            className={`glass-card p-6 transition-all ${!service.active ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-display font-semibold text-lg text-foreground">
                  {service.name}
                </h3>
                {!service.active && (
                  <span className="text-xs text-muted-foreground">(Inativo)</span>
                )}
                {(service as any).askDescription && (
                  <p className="text-xs text-muted-foreground mt-1">📝 Solicita descrição do problema</p>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openEditDialog(service)}
                  className="text-muted-foreground hover:text-primary"
                >
                  <Pencil size={16} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(service.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>

            <p className="text-sm text-muted-foreground mb-4">{service.description}</p>

            <div className="flex items-center justify-between pt-4 border-t border-border">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock size={14} />
                <span>{service.duration} min</span>
              </div>
              <div className="flex items-center gap-1 font-semibold text-primary">
                <DollarSign size={16} />
                <span>{formatPrice(service.price)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}