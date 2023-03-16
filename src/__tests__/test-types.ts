
export interface Human {
  passportId: string,
  firstName: string,
  lastName: string,
  age?: number
}

export const HUMAN_SCHEMA = {
  title: 'human schema',
  version: 0,
  primaryKey: 'passportId',
  type: 'object',
  properties: {
      passportId: {
          type: 'string',
          maxLength: 100
      },
      firstName: {
          type: 'string'
      },
      lastName: {
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
  required: ['firstName', 'lastName', 'passportId'],
  indexes: ['age']
}  
