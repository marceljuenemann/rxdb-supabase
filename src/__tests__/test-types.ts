
export interface Human {
  id: string,
  name: string,
  age: number | null
}

export const HUMAN_SCHEMA = {
  title: 'human schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
      id: {
          type: 'string',
          maxLength: 100
      },
      name: {
          type: 'string'
      },
      age: {
          description: 'age in years',
          type: 'integer',
          minimum: 0,
          maximum: 150,
          multipleOf: 1
      }
  },
  required: ['name', 'id', 'age'],
  indexes: ['age']
}  
